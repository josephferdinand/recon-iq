-- Enterprise self signup: a domain routes a verified identity to one tenant only.
-- A route never grants membership. Domain ownership requires a server checked TXT record.
CREATE TABLE public.tenant_email_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  domain citext NOT NULL UNIQUE,
  verification_token text NOT NULL DEFAULT ('fvi-email-' || encode(gen_random_bytes(24), 'hex')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','suspended')),
  created_by uuid REFERENCES auth.users(id),
  verified_by uuid REFERENCES auth.users(id),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_email_domain_format CHECK (
    domain::text = lower(domain::text)
    AND domain::text ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$'
    AND length(domain::text) <= 253
  ),
  CONSTRAINT tenant_email_domain_verified CHECK ((status = 'verified') = (verified_at IS NOT NULL))
);
CREATE INDEX tenant_email_domains_tenant_idx ON public.tenant_email_domains(tenant_id);
ALTER TABLE public.tenant_email_domains ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_email_domains FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tenant_email_domains TO authenticated;
GRANT ALL ON public.tenant_email_domains TO service_role;
CREATE POLICY tenant_email_domains_platform_read ON public.tenant_email_domains
  FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));

-- Records the additive-schema boundary so strict cutover can detect any
-- domainless tenants created during the old-app compatibility window.
CREATE TABLE public.tenant_email_domain_rollout (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  schema_ready_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.tenant_email_domain_rollout(singleton) VALUES (true);
ALTER TABLE public.tenant_email_domain_rollout ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_email_domain_rollout FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tenant_email_domain_rollout TO service_role;

-- All membership writers (invitations, SCIM, admin tools) obey the new tenant domain.
-- Platform administrators retain their operational cross-tenant access.
CREATE FUNCTION public.enforce_tenant_email_domain_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_email text; v_domain text;
BEGIN
  IF public.is_platform_admin(NEW.user_id) THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_email_domains WHERE tenant_id=NEW.tenant_id) THEN RETURN NEW; END IF;
  SELECT lower(u.email) INTO v_email FROM auth.users u
    WHERE u.id=NEW.user_id AND u.email_confirmed_at IS NOT NULL;
  v_domain := split_part(coalesce(v_email,''),'@',2);
  IF NOT EXISTS (SELECT 1 FROM public.tenant_email_domains d
                 WHERE d.tenant_id=NEW.tenant_id AND d.domain=v_domain AND d.status='verified')
     OR EXISTS (SELECT 1 FROM public.tenant_members m
                WHERE m.user_id=NEW.user_id AND m.tenant_id<>NEW.tenant_id) THEN
    RAISE EXCEPTION 'Membership is unavailable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_tenant_email_domain_membership() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER tenant_members_email_domain_guard
  BEFORE INSERT OR UPDATE OF tenant_id,user_id,active ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_email_domain_membership();

-- The platform creation path is atomic, including the domain reservation.
CREATE FUNCTION public.create_tenant_with_email_domain(
  _family_id uuid, _slug text, _name text, _environment public.env_tier,
  _ai_enabled boolean, _email_domain text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_tenant uuid; v_domain text := lower(trim(_email_domain));
BEGIN
  IF v_actor IS NULL OR NOT public.is_platform_admin(v_actor) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF v_domain IS NULL OR v_domain !~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$'
     OR length(v_domain) > 253 THEN
    RAISE EXCEPTION 'Invalid email domain' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.tenants(family_id,slug,name,environment,ai_enabled,created_by)
  VALUES (_family_id,_slug,_name,_environment,_ai_enabled,v_actor) RETURNING id INTO v_tenant;
  INSERT INTO public.tenant_email_domains(tenant_id,domain,created_by)
  VALUES (v_tenant,v_domain,v_actor);
  INSERT INTO public.tenant_members(tenant_id,user_id,role,invited_by)
  VALUES (v_tenant,v_actor,'tenant_admin'::public.tenant_role,v_actor)
  ON CONFLICT (tenant_id,user_id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.tenant_id=v_tenant
                 AND m.user_id=v_actor AND m.active AND m.role='tenant_admin'::public.tenant_role) THEN
    RAISE EXCEPTION 'Tenant administrator setup failed' USING ERRCODE='23514';
  END IF;
  RETURN v_tenant;
END $$;
REVOKE ALL ON FUNCTION public.create_tenant_with_email_domain(uuid,text,text,public.env_tier,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_tenant_with_email_domain(uuid,text,text,public.env_tier,boolean,text) TO authenticated;

-- Only trusted server code may call this after checking DNS TXT for the token.
CREATE FUNCTION public.mark_tenant_email_domain_verified(_domain_id uuid, _verified_by uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF _verified_by IS NULL OR NOT public.is_platform_admin(_verified_by) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.tenant_email_domains SET status='verified', verified_by=_verified_by, verified_at=now()
  WHERE id=_domain_id AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Domain unavailable' USING ERRCODE = '22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.mark_tenant_email_domain_verified(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_tenant_email_domain_verified(uuid,uuid) TO service_role;

CREATE TABLE public.tenant_signup_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email citext NOT NULL,
  full_name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES auth.users(id),
  UNIQUE (user_id),
  CONSTRAINT tenant_signup_decision_consistent CHECK (
    (status='pending' AND decided_at IS NULL AND decided_by IS NULL)
    OR (status IN ('approved','denied') AND decided_at IS NOT NULL AND decided_by IS NOT NULL)
  )
);
CREATE INDEX tenant_signup_requests_queue_idx ON public.tenant_signup_requests(tenant_id,status,requested_at DESC);
ALTER TABLE public.tenant_signup_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_signup_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tenant_signup_requests TO authenticated;
GRANT ALL ON public.tenant_signup_requests TO service_role;
CREATE POLICY tenant_signup_requests_admin_read ON public.tenant_signup_requests
  FOR SELECT TO authenticated USING (
    public.is_platform_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.tenant_members m WHERE m.tenant_id=tenant_signup_requests.tenant_id
      AND m.user_id=auth.uid() AND m.active AND m.role='tenant_admin'::public.tenant_role
    )
  );

-- Private durable notification outbox; email delivery is handled by the app.
CREATE TABLE public.tenant_signup_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.tenant_signup_requests(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_name text NOT NULL CHECK (event_name IN ('signup.admission_requested','signup.admission_approved','signup.admission_denied')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz
);
CREATE INDEX tenant_signup_events_unsent_idx ON public.tenant_signup_events(occurred_at) WHERE notified_at IS NULL;
ALTER TABLE public.tenant_signup_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_signup_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.tenant_signup_events TO service_role;

-- Email is sourced from Auth, never from a caller supplied claim or metadata.
-- A generic result avoids revealing whether a domain is registered or enabled.
CREATE FUNCTION public.request_tenant_admission() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_email text; v_name text; v_tenant uuid; v_request uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  SELECT lower(u.email), left(coalesce(u.raw_user_meta_data->>'full_name',''),120)
    INTO v_email,v_name FROM auth.users u
    WHERE u.id=v_actor AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL OR v_email !~ '^[^@]+@[^@]+$' THEN RETURN true; END IF;
  SELECT d.tenant_id INTO v_tenant FROM public.tenant_email_domains d
    WHERE d.domain=split_part(v_email,'@',2) AND d.status='verified';
  IF v_tenant IS NULL THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.user_id=v_actor) THEN RETURN true; END IF;
  INSERT INTO public.tenant_signup_requests(tenant_id,user_id,email,full_name)
  VALUES (v_tenant,v_actor,v_email,nullif(v_name,''))
  ON CONFLICT (user_id) DO NOTHING RETURNING id INTO v_request;
  IF v_request IS NOT NULL THEN
    INSERT INTO public.tenant_signup_events(request_id,tenant_id,user_id,event_name)
    VALUES (v_request,v_tenant,v_actor,'signup.admission_requested');
    -- Applicant has no tenant membership yet, so audit attribution is user scope.
    INSERT INTO public.audit_log(actor_user_id,scope,action,resource_type,resource_id,context)
    VALUES (v_actor,'user','signup.admission_requested','tenant_signup_request',v_request::text,'{}'::jsonb);
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.request_tenant_admission() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_tenant_admission() TO authenticated;

-- This RPC is the only admission path; its decision and membership write share a transaction.
CREATE FUNCTION public.decide_tenant_admission(_tenant_id uuid, _request_id uuid, _decision text)
RETURNS public.tenant_signup_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_request public.tenant_signup_requests; v_auth_email text;
BEGIN
  IF _decision NOT IN ('approved','denied') THEN RAISE EXCEPTION 'Invalid decision' USING ERRCODE='22023'; END IF;
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tenant_members m WHERE m.tenant_id=_tenant_id
      AND m.user_id=v_actor AND m.active AND m.role='tenant_admin'::public.tenant_role
  ) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_request FROM public.tenant_signup_requests r
    WHERE r.id=_request_id AND r.tenant_id=_tenant_id AND r.status='pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='22023'; END IF;
  IF v_request.user_id=v_actor THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  SELECT lower(u.email) INTO v_auth_email FROM auth.users u
    WHERE u.id=v_request.user_id AND u.email_confirmed_at IS NOT NULL;
  IF v_auth_email IS NULL OR v_auth_email<>lower(v_request.email::text)
     OR NOT EXISTS (SELECT 1 FROM public.tenant_email_domains d
                    WHERE d.tenant_id=_tenant_id AND d.domain=split_part(v_auth_email,'@',2)
                      AND d.status='verified') THEN
    RAISE EXCEPTION 'Request unavailable' USING ERRCODE='22023';
  END IF;
  IF _decision='approved' THEN
    IF EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.user_id=v_request.user_id AND m.tenant_id<>_tenant_id) THEN
      RAISE EXCEPTION 'Request unavailable' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.tenant_members(tenant_id,user_id,role,invited_by)
    VALUES (_tenant_id,v_request.user_id,'tenant_viewer'::public.tenant_role,v_actor)
    ON CONFLICT (tenant_id,user_id) DO NOTHING;
    IF NOT EXISTS (SELECT 1 FROM public.tenant_members m
                   WHERE m.tenant_id=_tenant_id AND m.user_id=v_request.user_id
                     AND m.active=true AND m.role='tenant_viewer'::public.tenant_role) THEN
      RAISE EXCEPTION 'Request unavailable' USING ERRCODE='22023';
    END IF;
  END IF;
  UPDATE public.tenant_signup_requests SET status=_decision,decided_at=now(),decided_by=v_actor
    WHERE id=_request_id RETURNING * INTO v_request;
  INSERT INTO public.tenant_signup_events(request_id,tenant_id,user_id,event_name)
  VALUES (_request_id,_tenant_id,v_request.user_id,'signup.admission_'||_decision);
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (v_actor,_tenant_id,'tenant','signup.admission_'||_decision,'tenant_signup_request',_request_id::text,
          jsonb_build_object('user_id',v_request.user_id));
  RETURN v_request;
END $$;
REVOKE ALL ON FUNCTION public.decide_tenant_admission(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_tenant_admission(uuid,uuid,text) TO authenticated;
