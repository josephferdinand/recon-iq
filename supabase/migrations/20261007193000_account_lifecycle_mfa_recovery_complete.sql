-- BEGIN INPUT: Nash verified producer prerequisite
-- Additive, service-only notification proposal. Parent applies with exact catalog guards.
-- Authentication stays with Supabase; no role, password, MFA, session or hook changes.
CREATE TABLE private.failed_login_attempts (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  binding text NOT NULL CHECK (binding ~ '^[0-9a-f]{64}$'),
  stage text NOT NULL CHECK (stage IN ('password','mfa','policy')),
  user_id uuid,
  recipient_email text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  outcome text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','success','invalid_credentials','mfa_invalid','mfa_expired','account_locked','rate_limited','policy_blocked','provider_unavailable','verification_failed')),
  delivery_state text NOT NULL DEFAULT 'not_required' CHECK (delivery_state IN ('not_required','no_verified_recipient','recorded','queued','sending','retry','uncertain','provider_accepted','delivered','bounced','dead_letter','recipient_changed')),
  queue_message_id bigint UNIQUE,
  lease_id uuid,
  dispatch_started_at timestamptz,
  dispatch_count integer NOT NULL DEFAULT 0,
  provider_message_id text,
  diagnostic_code text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.failed_login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.failed_login_attempts FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX failed_login_pending_delivery ON private.failed_login_attempts(created_at) WHERE delivery_state IN ('recorded','retry','uncertain','sending');

CREATE TABLE private.failed_login_delivery_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES private.failed_login_attempts(id),
  state text NOT NULL,
  diagnostic_code text,
  provider_message_id text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.failed_login_delivery_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.failed_login_delivery_audit FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE private.failed_login_delivery_audit_id_seq FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.failed_login_begin(_id uuid, _binding text, _stage text, _email text DEFAULT NULL, _user_id uuid DEFAULT NULL, _request_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,private,public,pg_temp AS $$
DECLARE a private.failed_login_attempts; actor uuid; recipient text;
BEGIN
  IF _binding IS NULL OR _binding !~ '^[0-9a-f]{64}$' OR _stage NOT IN ('password','mfa','policy') OR _stage IS NULL THEN RAISE EXCEPTION 'Invalid attempt' USING ERRCODE='22023'; END IF;
  IF _stage='password' THEN
    SELECT u.id,u.email INTO actor,recipient FROM auth.users u WHERE lower(u.email)=lower(trim(_email)) AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL AND NOT coalesce(u.is_anonymous,false) LIMIT 1;
  ELSE
    SELECT u.id,u.email INTO actor,recipient FROM auth.users u WHERE u.id=_user_id AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL AND NOT coalesce(u.is_anonymous,false);
  END IF;
  INSERT INTO private.failed_login_attempts(id,request_id,binding,stage,user_id,recipient_email) VALUES (_id,coalesce(_request_id,gen_random_uuid()),_binding,_stage,actor,recipient) ON CONFLICT(id) DO NOTHING;
  IF FOUND THEN RETURN jsonb_build_object('acquired',true,'outcome','pending','requestId',(SELECT request_id FROM private.failed_login_attempts WHERE id=_id)); END IF;
  SELECT * INTO a FROM private.failed_login_attempts WHERE id=_id FOR UPDATE;
  IF a.binding<>_binding OR a.stage<>_stage THEN RAISE EXCEPTION 'Attempt conflict' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('acquired',false,'outcome',a.outcome,'requestId',a.request_id);
END;
$$;

CREATE FUNCTION public.failed_login_finish(_id uuid, _binding text, _outcome text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,private,public,pg_temp AS $$
DECLARE a private.failed_login_attempts; q bigint;
BEGIN
  IF _outcome NOT IN ('success','invalid_credentials','mfa_invalid','mfa_expired','account_locked','rate_limited','policy_blocked','provider_unavailable','verification_failed') OR _outcome IS NULL THEN RAISE EXCEPTION 'Invalid outcome' USING ERRCODE='22023'; END IF;
  SELECT * INTO a FROM private.failed_login_attempts WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR a.binding<>_binding THEN RAISE EXCEPTION 'Attempt conflict' USING ERRCODE='22023'; END IF;
  IF (_outcome='invalid_credentials' AND a.stage<>'password') OR (_outcome IN ('mfa_invalid','mfa_expired') AND a.stage<>'mfa') OR (_outcome='policy_blocked' AND a.stage<>'policy') THEN RAISE EXCEPTION 'Outcome stage conflict' USING ERRCODE='22023'; END IF;
  IF a.outcome<>'pending' THEN
    IF a.outcome<>_outcome THEN RAISE EXCEPTION 'Outcome conflict' USING ERRCODE='22023'; END IF;
    RETURN true;
  END IF;
  UPDATE private.failed_login_attempts SET outcome=_outcome,finished_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=_id;
  IF _outcome='success' THEN RETURN true; END IF;
  -- Canonical trusted event; browser security-events do not feed this pipeline.
  INSERT INTO public.security_events(user_id,event_type,severity,context) VALUES (a.user_id,'auth.failed_login.verified','warning',jsonb_build_object('attempt_id',_id,'request_id',a.request_id,'stage',a.stage,'outcome',_outcome,'source','server_authentication'));
  IF a.user_id IS NULL OR a.recipient_email IS NULL THEN
    UPDATE private.failed_login_attempts SET delivery_state='no_verified_recipient' WHERE id=_id;
    INSERT INTO private.failed_login_delivery_audit(attempt_id,state) VALUES(_id,'no_verified_recipient');
    RETURN true;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=a.user_id AND u.email=a.recipient_email AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL AND NOT coalesce(u.is_anonymous,false)) THEN
    UPDATE private.failed_login_attempts SET delivery_state='recipient_changed',diagnostic_code='recipient_changed' WHERE id=_id;
    INSERT INTO private.failed_login_delivery_audit(attempt_id,state,diagnostic_code) VALUES(_id,'recipient_changed','recipient_changed');
    RETURN true;
  END IF;
  UPDATE private.failed_login_attempts SET delivery_state='recorded' WHERE id=_id;
  INSERT INTO private.failed_login_delivery_audit(attempt_id,state) VALUES(_id,'recorded');
  BEGIN
    q:=public.enqueue_email('transactional_emails',jsonb_build_object('template','auth.failed_login.verified','attempt_id',_id));
    UPDATE private.failed_login_attempts SET delivery_state='queued',queue_message_id=q WHERE id=_id;
    INSERT INTO private.failed_login_delivery_audit(attempt_id,state) VALUES(_id,'queued');
  EXCEPTION WHEN OTHERS THEN
    UPDATE private.failed_login_attempts SET diagnostic_code='queue_unavailable' WHERE id=_id;
    INSERT INTO private.failed_login_delivery_audit(attempt_id,state,diagnostic_code) VALUES(_id,'recorded','queue_unavailable');
  END;
  RETURN true;
END;
$$;

CREATE FUNCTION public.failed_login_requeue_recorded()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,private,public,pg_temp AS $$
DECLARE a private.failed_login_attempts; q bigint; count_queued integer:=0;
BEGIN
  FOR a IN SELECT * FROM private.failed_login_attempts WHERE delivery_state='recorded' ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED LOOP
    BEGIN
      q:=public.enqueue_email('transactional_emails',jsonb_build_object('template','auth.failed_login.verified','attempt_id',a.id));
      UPDATE private.failed_login_attempts SET delivery_state='queued',queue_message_id=q,diagnostic_code=NULL,updated_at=clock_timestamp() WHERE id=a.id;
      INSERT INTO private.failed_login_delivery_audit(attempt_id,state) VALUES(a.id,'queued'); count_queued:=count_queued+1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE private.failed_login_attempts SET diagnostic_code='queue_unavailable',updated_at=clock_timestamp() WHERE id=a.id;
    END;
  END LOOP;
  RETURN count_queued;
END;
$$;

CREATE FUNCTION public.failed_login_claim(_id uuid, _queue_message_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,private,public,pg_temp AS $$
DECLARE a private.failed_login_attempts; lease uuid;
BEGIN
  SELECT * INTO a FROM private.failed_login_attempts WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR a.queue_message_id IS DISTINCT FROM _queue_message_id THEN RETURN jsonb_build_object('send',false,'state','unattributed'); END IF;
  IF a.delivery_state IN ('provider_accepted','delivered','bounced') THEN PERFORM public.delete_email('transactional_emails',_queue_message_id); RETURN jsonb_build_object('send',false,'state',a.delivery_state); END IF;
  IF a.delivery_state='sending' AND a.dispatch_started_at<clock_timestamp()-interval '5 minutes' THEN
    UPDATE private.failed_login_attempts SET delivery_state='uncertain',diagnostic_code='dispatch_interrupted',updated_at=clock_timestamp() WHERE id=_id;
    INSERT INTO private.failed_login_delivery_audit(attempt_id,state,diagnostic_code) VALUES(_id,'uncertain','dispatch_interrupted');
    RETURN jsonb_build_object('send',false,'state','uncertain');
  END IF;
  IF a.delivery_state NOT IN ('queued','retry') THEN RETURN jsonb_build_object('send',false,'state',a.delivery_state); END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=a.user_id AND u.email=a.recipient_email AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL AND NOT coalesce(u.is_anonymous,false)) THEN
    UPDATE private.failed_login_attempts SET delivery_state='recipient_changed',diagnostic_code='recipient_changed',updated_at=clock_timestamp() WHERE id=_id;
    INSERT INTO private.failed_login_delivery_audit(attempt_id,state,diagnostic_code) VALUES(_id,'recipient_changed','recipient_changed');
    RETURN jsonb_build_object('send',false,'state','recipient_changed');
  END IF;
  lease:=gen_random_uuid();
  UPDATE private.failed_login_attempts SET delivery_state='sending',lease_id=lease,dispatch_started_at=clock_timestamp(),dispatch_count=dispatch_count+1,updated_at=clock_timestamp() WHERE id=_id;
  INSERT INTO private.failed_login_delivery_audit(attempt_id,state) VALUES(_id,'sending');
  RETURN jsonb_build_object('send',true,'lease_id',lease,'to',a.recipient_email,'occurred_at',a.created_at,'outcome',a.outcome,'attempt_id',a.id,'request_id',a.request_id);
END;
$$;

CREATE FUNCTION public.failed_login_settle(_id uuid, _lease_id uuid, _state text, _provider_message_id text DEFAULT NULL, _diagnostic_code text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,private,public,pg_temp AS $$
DECLARE a private.failed_login_attempts; final_state text;
BEGIN
  IF _state NOT IN ('provider_accepted','retry','uncertain') OR _state IS NULL OR (_provider_message_id IS NOT NULL AND (length(_provider_message_id)>200 OR _provider_message_id !~ '^[A-Za-z0-9_.:-]+$' OR _provider_message_id ~ '^(request:)?[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' OR _provider_message_id ~* '^(request:)?(sb_secret_|sb_publishable_|sbp_|Zoho-enczapikey)')) OR (_diagnostic_code IS NOT NULL AND _diagnostic_code NOT IN ('provider_rejected','provider_rate_limited','provider_timeout','provider_response_unknown','provider_unavailable')) THEN RAISE EXCEPTION 'Invalid delivery receipt' USING ERRCODE='22023'; END IF;
  IF _state='provider_accepted' AND _provider_message_id IS NULL THEN RAISE EXCEPTION 'Acceptance receipt required' USING ERRCODE='22023'; END IF;
  SELECT * INTO a FROM private.failed_login_attempts WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR a.lease_id IS DISTINCT FROM _lease_id OR _lease_id IS NULL THEN RETURN false; END IF;
  IF (a.delivery_state=_state OR (_state='provider_accepted' AND a.delivery_state IN ('delivered','bounced'))) AND a.provider_message_id IS NOT DISTINCT FROM _provider_message_id THEN RETURN true; END IF;
  IF a.delivery_state NOT IN ('sending','uncertain') THEN RETURN false; END IF;
  -- An interrupted/ambiguous HTTP send is never automatically replayed.
  IF a.delivery_state='uncertain' AND _state='retry' THEN RETURN false; END IF;
  final_state:=CASE WHEN _state='retry' AND a.dispatch_count>=5 THEN 'dead_letter' ELSE _state END;
  UPDATE private.failed_login_attempts SET delivery_state=final_state,provider_message_id=_provider_message_id,diagnostic_code=_diagnostic_code,updated_at=clock_timestamp() WHERE id=_id;
  INSERT INTO private.failed_login_delivery_audit(attempt_id,state,diagnostic_code,provider_message_id) VALUES(_id,final_state,_diagnostic_code,_provider_message_id);
  IF _state='provider_accepted' THEN
    INSERT INTO public.email_send_log(message_id,template_name,recipient_email,status,metadata) VALUES(_provider_message_id,'auth.failed_login.verified',a.recipient_email,'sent',jsonb_build_object('attempt_id',_id,'queue_message_id',a.queue_message_id,'delivery_state','provider_accepted'));
    PERFORM public.delete_email('transactional_emails',a.queue_message_id);
  ELSIF final_state='dead_letter' THEN
    PERFORM public.move_to_dlq('transactional_emails','transactional_emails_dlq',a.queue_message_id,jsonb_build_object('template','auth.failed_login.verified','attempt_id',_id));
  END IF;
  RETURN true;
END;
$$;

-- Delivery readback is service-only and requires exact provider correlation.
-- Parent wires this only behind an existing authenticated provider webhook or
-- a separately verified provider-log read. Browser events cannot call it.
CREATE FUNCTION public.failed_login_delivery_receipt(_id uuid, _provider_message_id text, _state text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,private,public,pg_temp AS $$
DECLARE a private.failed_login_attempts;
BEGIN
  IF _state NOT IN ('delivered','bounced') OR _state IS NULL THEN RAISE EXCEPTION 'Invalid delivery state' USING ERRCODE='22023'; END IF;
  SELECT * INTO a FROM private.failed_login_attempts WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR a.provider_message_id IS DISTINCT FROM _provider_message_id OR _provider_message_id IS NULL OR a.delivery_state NOT IN ('provider_accepted','delivered','bounced') THEN RETURN false; END IF;
  IF a.delivery_state=_state THEN RETURN true; END IF;
  IF a.delivery_state IN ('delivered','bounced') THEN RETURN false; END IF;
  UPDATE private.failed_login_attempts SET delivery_state=_state,updated_at=clock_timestamp() WHERE id=_id;
  INSERT INTO private.failed_login_delivery_audit(attempt_id,state,provider_message_id) VALUES(_id,_state,_provider_message_id);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.failed_login_begin(uuid,text,text,text,uuid,uuid),public.failed_login_finish(uuid,text,text),public.failed_login_requeue_recorded(),public.failed_login_claim(uuid,bigint),public.failed_login_settle(uuid,uuid,text,text,text),public.failed_login_delivery_receipt(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.failed_login_begin(uuid,text,text,text,uuid,uuid),public.failed_login_finish(uuid,text,text),public.failed_login_requeue_recorded(),public.failed_login_claim(uuid,bigint),public.failed_login_settle(uuid,uuid,text,text,text),public.failed_login_delivery_receipt(uuid,text,text) TO service_role;

-- END INPUT: Nash verified producer prerequisite

-- BEGIN INPUT: Frozen lifecycle
-- PROPOSAL ONLY. Parent chooses migration version, catalog guards and PG17.6 rollback/apply.
-- All functions retain current Supabase UUID/JWT/MFA authority. No secret/OTP/password storage.
CREATE TABLE private.rlnext_policy (
 tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id), enabled boolean NOT NULL DEFAULT false,
 allowed_domains text[] NOT NULL DEFAULT '{}', blocked_domains text[] NOT NULL DEFAULT ARRAY['gmail.com','yahoo.com','outlook.com'],
 ttl_seconds integer NOT NULL DEFAULT 600 CHECK(ttl_seconds BETWEEN 120 AND 1800),
 max_resends integer NOT NULL DEFAULT 3 CHECK(max_resends BETWEEN 0 AND 5),
 max_attempts integer NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 10),
 failed_login_limit integer NOT NULL DEFAULT 5 CHECK(failed_login_limit BETWEEN 3 AND 20)
);
CREATE TABLE private.rlnext_accounts (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenants(id), user_id uuid UNIQUE REFERENCES auth.users(id),
 email text NOT NULL, first_name text NOT NULL DEFAULT '', last_name text NOT NULL DEFAULT '',
 department text NOT NULL DEFAULT '', employee_id text NOT NULL DEFAULT '', job_title text NOT NULL DEFAULT '',
 status text NOT NULL CHECK(status IN('active','locked','disabled','pending_approval','pending_verification','suspended','rejected')),
 version integer NOT NULL DEFAULT 1, requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 verified_at timestamptz, decided_at timestamptz, decided_by uuid REFERENCES auth.users(id),
 lock_reason text, locked_at timestamptz, reset_required boolean NOT NULL DEFAULT false, assigned boolean NOT NULL DEFAULT false, provider_locked boolean NOT NULL DEFAULT false,
 UNIQUE(tenant_id,email), CHECK(email=lower(email)), CHECK(length(email)<=254)
);
CREATE INDEX rlnext_accounts_queue ON private.rlnext_accounts(tenant_id,status,requested_at DESC);
CREATE TABLE private.rlnext_challenges (
 id uuid PRIMARY KEY, account_id uuid REFERENCES private.rlnext_accounts(id), tenant_id uuid REFERENCES public.tenants(id),
 purpose text NOT NULL CHECK(purpose IN('verify','unlock','password_reset')), receipt_hash text NOT NULL CHECK(receipt_hash ~ '^[a-f0-9]{64}$'),
 otp_hash text NOT NULL CHECK(otp_hash ~ '^[a-f0-9]{64}$'), reset_hash text CHECK(reset_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 attempts integer NOT NULL DEFAULT 0, resends integer NOT NULL DEFAULT 0, last_sent_at timestamptz,
 max_attempts integer NOT NULL, max_resends integer NOT NULL, ttl_seconds integer NOT NULL,
 create_state text NOT NULL DEFAULT 'none' CHECK(create_state IN('none','claimed','created','uncertain')),
 send_state text NOT NULL DEFAULT 'ready' CHECK(send_state IN('ready','claimed','accepted','rejected','uncertain')),
 verify_state text NOT NULL DEFAULT 'ready' CHECK(verify_state IN('ready','claimed','complete','exhausted')),
 reset_state text NOT NULL DEFAULT 'none' CHECK(reset_state IN('none','ready','claimed','complete','uncertain')),
 used_at timestamptz, reset_expires_at timestamptz, password_before text, provider_ref text
);
CREATE TABLE private.rlnext_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 account_id uuid REFERENCES private.rlnext_accounts(id), actor_id uuid REFERENCES auth.users(id),
 event text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(), reason text,
 context jsonb NOT NULL DEFAULT '{}'::jsonb, CHECK(length(reason)<=800)
);
CREATE INDEX rlnext_audit_page ON private.rlnext_audit(tenant_id,occurred_at DESC,id);
CREATE TABLE private.rlnext_notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 account_id uuid NOT NULL REFERENCES private.rlnext_accounts(id), recipient_id uuid NOT NULL REFERENCES auth.users(id),
 event text NOT NULL, reason text, state text NOT NULL DEFAULT 'ready' CHECK(state IN('ready','claimed','accepted','rejected','uncertain')),
 lease uuid, provider_ref text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), claimed_at timestamptz
);
CREATE TABLE private.rlnext_invitations (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 email text NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz,
 created_by uuid NOT NULL REFERENCES auth.users(id)
);
-- Private tables have no browser grants, including through schema discovery.
ALTER TABLE private.rlnext_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.rlnext_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.rlnext_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.rlnext_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.rlnext_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.rlnext_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.rlnext_policy,private.rlnext_accounts,private.rlnext_challenges,private.rlnext_audit,private.rlnext_notices,private.rlnext_invitations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.rlnext_service() RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF; END $$;
CREATE FUNCTION public.rlnext_resolve(_domain text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE slug text;
BEGIN
 PERFORM private.rlnext_service();
 SELECT t.slug INTO slug FROM public.tenant_email_domains d JOIN public.tenants t ON t.id=d.tenant_id JOIN private.rlnext_policy p ON p.tenant_id=t.id
 WHERE d.domain::text=lower(_domain) AND d.status='verified' AND p.enabled AND private.rlnext_domain(t.id,'resolve@'||lower(_domain));
 RETURN jsonb_build_object('slug',slug);
END $$;
CREATE FUNCTION private.rlnext_admin_current(_tenant uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' OR NOT EXISTS(
   SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=actor AND active AND role::text='tenant_admin'
 ) OR EXISTS(SELECT 1 FROM private.rlnext_accounts WHERE user_id=actor AND (status<>'active' OR reset_required OR EXISTS(SELECT 1 FROM auth.users u WHERE u.id=actor AND u.banned_until>now())))
 THEN RAISE EXCEPTION 'Current tenant administrator with MFA required' USING ERRCODE='42501'; END IF;
 -- Prevent revocation racing a decision: hold current membership through this transaction.
 PERFORM 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=actor AND active AND role::text='tenant_admin' FOR SHARE;
 RETURN actor;
END $$;
CREATE FUNCTION private.rlnext_domain(_tenant uuid,_email text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.tenant_email_domains d WHERE d.tenant_id=_tenant AND d.domain::text=split_part(lower(_email),'@',2) AND d.status='verified')
 AND NOT EXISTS(SELECT 1 FROM private.rlnext_policy p WHERE p.tenant_id=_tenant AND (split_part(lower(_email),'@',2)=ANY(p.blocked_domains) OR cardinality(p.allowed_domains)>0 AND NOT split_part(lower(_email),'@',2)=ANY(p.allowed_domains)))
$$;
CREATE FUNCTION private.rlnext_record(_tenant uuid,_account uuid,_actor uuid,_event text,_reason text DEFAULT NULL,_context jsonb DEFAULT '{}'::jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO private.rlnext_audit(tenant_id,account_id,actor_id,event,reason,context) VALUES(_tenant,_account,_actor,_event,_reason,_context);
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
 VALUES(_actor,CASE WHEN _actor IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=_actor AND active) THEN NULL ELSE _tenant END,
 CASE WHEN _actor IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=_actor AND active) THEN 'user' ELSE 'tenant' END,
 'auth.lifecycle.'||_event,'account_lifecycle',_account::text,_context);
END $$;
CREATE FUNCTION private.rlnext_notice(_account uuid,_event text,_reason text DEFAULT NULL,_admins boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a private.rlnext_accounts;
BEGIN
 SELECT * INTO STRICT a FROM private.rlnext_accounts WHERE id=_account;
 IF _admins THEN
   INSERT INTO private.rlnext_notices(tenant_id,account_id,recipient_id,event,reason)
   SELECT a.tenant_id,a.id,m.user_id,_event,_reason FROM public.tenant_members m JOIN auth.users u ON u.id=m.user_id
   WHERE m.tenant_id=a.tenant_id AND m.active AND m.role::text='tenant_admin' AND u.email_confirmed_at IS NOT NULL;
 ELSIF a.user_id IS NOT NULL THEN
   INSERT INTO private.rlnext_notices(tenant_id,account_id,recipient_id,event,reason) VALUES(a.tenant_id,a.id,a.user_id,_event,_reason);
 END IF;
END $$;

CREATE FUNCTION public.rlnext_begin(_slug text,_email text,_purpose text,_id uuid,_receipt_hash text,_otp_hash text,_profile jsonb,_invitation_hash text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tenant uuid; a private.rlnext_accounts; p private.rlnext_policy; u auth.users; rate record;
BEGIN
 PERFORM private.rlnext_service();
 IF _purpose NOT IN('verify','unlock','password_reset') OR _email<>lower(trim(_email)) OR _email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' OR length(_email)>254
 OR _receipt_hash !~ '^[a-f0-9]{64}$' OR _otp_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023'; END IF;
 SELECT id INTO tenant FROM public.tenants WHERE slug=_slug;
 PERFORM pg_advisory_xact_lock(hashtextextended('rlnext:'||coalesce(tenant::text,'unknown'),0));
 -- Serialize all challenges for one tenant/email, including different request IDs.
 PERFORM pg_advisory_xact_lock(hashtextextended(coalesce(tenant::text,'')||':'||_email,0));
 IF EXISTS(SELECT 1 FROM private.rlnext_challenges WHERE id=_id) THEN RETURN jsonb_build_object('eligible',false); END IF;
 SELECT * INTO p FROM private.rlnext_policy WHERE tenant_id=tenant;
 SELECT * INTO u FROM auth.users WHERE lower(email)=_email;
 SELECT * INTO a FROM private.rlnext_accounts WHERE tenant_id=tenant AND email=_email FOR UPDATE;
 IF tenant IS NULL OR p.tenant_id IS NULL OR NOT p.enabled OR NOT private.rlnext_domain(tenant,_email) THEN RETURN jsonb_build_object('eligible',false); END IF;
 IF EXISTS(SELECT 1 FROM private.rlnext_challenges c JOIN private.rlnext_accounts q ON q.id=c.account_id
   WHERE q.tenant_id=tenant AND q.email=_email AND c.created_at>clock_timestamp()-interval '1 hour' HAVING count(*)>=3)
 THEN RETURN jsonb_build_object('eligible',false); END IF;
 IF _purpose='verify' THEN
   IF u.id IS NOT NULL OR a.id IS NOT NULL THEN RETURN jsonb_build_object('eligible',false); END IF;
   IF _invitation_hash IS NOT NULL THEN
     UPDATE private.rlnext_invitations SET used_at=clock_timestamp() WHERE token_hash=_invitation_hash AND tenant_id=tenant AND email=_email AND expires_at>clock_timestamp() AND used_at IS NULL;
     IF NOT FOUND THEN RETURN jsonb_build_object('eligible',false); END IF;
   END IF;
   INSERT INTO private.rlnext_accounts(id,tenant_id,email,first_name,last_name,department,employee_id,job_title,status)
   VALUES(_id,tenant,_email,left(coalesce(_profile->>'firstName',''),80),left(coalesce(_profile->>'lastName',''),80),left(coalesce(_profile->>'department',''),120),left(coalesce(_profile->>'employeeId',''),80),left(coalesce(_profile->>'jobTitle',''),120),'pending_verification') RETURNING * INTO a;
 ELSIF u.id IS NULL OR u.email_confirmed_at IS NULL OR public.is_platform_admin(u.id)
   OR NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=tenant AND user_id=u.id AND active)
   OR EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id=u.id AND tenant_id<>tenant)
 THEN RETURN jsonb_build_object('eligible',false);
 ELSE
   IF a.id IS NULL THEN
     INSERT INTO private.rlnext_accounts(id,tenant_id,user_id,email,status,verified_at,assigned)
     VALUES(u.id,tenant,u.id,_email,CASE WHEN u.banned_until>clock_timestamp() THEN 'locked' ELSE 'active' END,u.email_confirmed_at,true) RETURNING * INTO a;
   END IF;
   IF u.banned_until>clock_timestamp() AND a.status='active' THEN UPDATE private.rlnext_accounts SET status='locked',provider_locked=true,lock_reason='Supabase account restriction',locked_at=u.updated_at WHERE id=a.id RETURNING * INTO a; END IF;
   IF (_purpose='unlock' AND a.status<>'locked') OR (_purpose='password_reset' AND a.status NOT IN('active','locked')) THEN RETURN jsonb_build_object('eligible',false); END IF;
   IF a.user_id IS DISTINCT FROM u.id THEN RETURN jsonb_build_object('eligible',false); END IF;
 END IF;
 -- A still-outstanding challenge cannot be bypassed by another tab/key.
 IF EXISTS(SELECT 1 FROM private.rlnext_challenges WHERE account_id=a.id AND used_at IS NULL AND (expires_at>clock_timestamp() OR create_state='uncertain' OR send_state IN('claimed','uncertain') OR reset_state IN('claimed','uncertain')))
 THEN RETURN jsonb_build_object('eligible',false); END IF;
 INSERT INTO private.rlnext_challenges(id,account_id,tenant_id,purpose,receipt_hash,otp_hash,expires_at,max_attempts,max_resends,ttl_seconds,create_state)
 VALUES(_id,a.id,tenant,_purpose,_receipt_hash,_otp_hash,clock_timestamp()+make_interval(secs=>p.ttl_seconds),p.max_attempts,p.max_resends,p.ttl_seconds,CASE WHEN _purpose='verify' THEN 'claimed' ELSE 'none' END);
 PERFORM private.rlnext_record(tenant,a.id,NULL,CASE WHEN _purpose='verify' THEN 'signup' ELSE _purpose||'_requested' END);
 RETURN jsonb_build_object('eligible',true,'create',_purpose='verify');
END $$;
CREATE FUNCTION public.rlnext_auth_settle(_id uuid,_user_id uuid,_state text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.rlnext_challenges; a private.rlnext_accounts; u auth.users;
BEGIN
 PERFORM private.rlnext_service(); PERFORM pg_advisory_xact_lock(hashtextextended('rlnext:'||coalesce((SELECT tenant_id::text FROM private.rlnext_challenges WHERE id=_id),'unknown'),0)); SELECT * INTO STRICT c FROM private.rlnext_challenges WHERE id=_id FOR UPDATE;
 SELECT * INTO STRICT a FROM private.rlnext_accounts WHERE id=c.account_id FOR UPDATE;
 IF c.create_state<>'claimed' OR c.purpose<>'verify' THEN RETURN jsonb_build_object('ready',false); END IF;
 SELECT * INTO u FROM auth.users WHERE id=_user_id AND lower(email)=a.email AND email_confirmed_at IS NULL AND raw_user_meta_data->>'fvi_lifecycle_request'=_id::text;
 IF _state='created' AND u.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id=u.id) THEN
   UPDATE private.rlnext_accounts SET user_id=u.id WHERE id=a.id;
   UPDATE private.rlnext_challenges SET create_state='created' WHERE id=c.id;
   RETURN jsonb_build_object('ready',true);
 END IF;
 UPDATE private.rlnext_challenges SET create_state='uncertain' WHERE id=c.id;
 PERFORM private.rlnext_record(a.tenant_id,a.id,NULL,'signup_held');
 RETURN jsonb_build_object('ready',false);
END $$;
CREATE FUNCTION public.rlnext_send(_id uuid,_action text,_state text,_provider_ref text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.rlnext_challenges; a private.rlnext_accounts;
BEGIN
 PERFORM private.rlnext_service(); SELECT * INTO STRICT c FROM private.rlnext_challenges WHERE id=_id FOR UPDATE;
 SELECT * INTO STRICT a FROM private.rlnext_accounts WHERE id=c.account_id;
 IF _action='claim' THEN
   IF c.send_state<>'ready' OR c.verify_state<>'ready' OR c.expires_at<=clock_timestamp() OR NOT private.rlnext_domain(a.tenant_id,a.email) OR (c.purpose='verify' AND c.create_state<>'created') THEN RETURN jsonb_build_object('send',false); END IF;
   UPDATE private.rlnext_challenges SET send_state='claimed',last_sent_at=clock_timestamp() WHERE id=c.id;
   RETURN jsonb_build_object('send',true,'to',a.email);
 ELSIF _action='settle' AND c.send_state='claimed' AND _state IN('accepted','rejected','uncertain') THEN
   IF _provider_ref IS NOT NULL AND (_provider_ref !~ '^[A-Za-z0-9_.:-]{1,200}$' OR _provider_ref ~* '(sb_secret_|sb_publishable_|zoho-enczapikey)' OR _provider_ref ~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$') THEN RAISE EXCEPTION 'Invalid receipt' USING ERRCODE='22023'; END IF;
   UPDATE private.rlnext_challenges SET send_state=_state,provider_ref=_provider_ref WHERE id=c.id;
   PERFORM private.rlnext_record(a.tenant_id,a.id,NULL,'email_'||_state,NULL,jsonb_build_object('request_id',c.id));
   RETURN jsonb_build_object('settled',true);
 END IF;
 RETURN jsonb_build_object('settled',false);
END $$;
CREATE FUNCTION public.rlnext_status(_id uuid,_receipt_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.rlnext_challenges; a private.rlnext_accounts;
BEGIN
 PERFORM private.rlnext_service(); SELECT * INTO c FROM private.rlnext_challenges WHERE id=_id AND (receipt_hash=_receipt_hash OR reset_hash=_receipt_hash) AND created_at>clock_timestamp()-interval '24 hours';
 IF c.id IS NULL THEN RETURN '{}'::jsonb; END IF;
 SELECT * INTO STRICT a FROM private.rlnext_accounts WHERE id=c.account_id;
 IF c.create_state='uncertain' THEN
   UPDATE private.rlnext_accounts ac SET user_id=u.id FROM auth.users u WHERE ac.id=a.id AND ac.user_id IS NULL AND lower(u.email)=ac.email AND u.email_confirmed_at IS NULL AND u.raw_user_meta_data->>'fvi_lifecycle_request'=c.id::text AND NOT EXISTS(SELECT 1 FROM public.tenant_members m WHERE m.user_id=u.id);
   IF FOUND THEN UPDATE private.rlnext_challenges SET create_state='created' WHERE id=c.id; c.create_state:='created'; END IF;
 END IF;
 IF c.verify_state='claimed' AND c.purpose='verify' THEN RETURN public.rlnext_verify_finish(c.id,false); END IF;
 IF c.reset_state IN('claimed','uncertain') THEN
   IF (public.rlnext_reset_finish(c.id,false)->>'completed')::boolean THEN RETURN jsonb_build_object('status','active','assigned',a.assigned,'completed',true); END IF;
 END IF;
 RETURN jsonb_build_object('status',a.status,'assigned',a.assigned,'reset_required',c.reset_state IN('ready','claimed','uncertain'),'reset_expires',floor(extract(epoch FROM c.reset_expires_at)*1000)::bigint,'held',c.create_state='uncertain' OR c.send_state IN('claimed','uncertain') OR c.verify_state='claimed' OR c.reset_state IN('claimed','uncertain'));
END $$;
CREATE FUNCTION public.rlnext_resend(_id uuid,_receipt_hash text,_otp_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.rlnext_challenges; a private.rlnext_accounts;
BEGIN
 PERFORM private.rlnext_service(); SELECT * INTO c FROM private.rlnext_challenges WHERE id=_id AND receipt_hash=_receipt_hash FOR UPDATE;
 IF c.id IS NULL THEN RETURN jsonb_build_object('ready',false); END IF;
 SELECT * INTO STRICT a FROM private.rlnext_accounts WHERE id=c.account_id;
 IF c.verify_state<>'ready' OR c.used_at IS NOT NULL OR c.send_state IN('claimed','uncertain') OR c.resends>=c.max_resends OR c.created_at<clock_timestamp()-interval '24 hours' OR c.attempts>=c.max_attempts OR NOT private.rlnext_domain(a.tenant_id,a.email) OR (c.purpose='verify' AND a.status<>'pending_verification') OR (c.purpose='unlock' AND a.status<>'locked') OR (c.purpose='password_reset' AND a.status NOT IN('active','locked'))
 THEN RETURN jsonb_build_object('ready',false); END IF;
 IF c.last_sent_at>clock_timestamp()-interval '60 seconds' THEN RETURN jsonb_build_object('ready',false,'retry_after',60); END IF;
 UPDATE private.rlnext_challenges SET otp_hash=_otp_hash,expires_at=clock_timestamp()+make_interval(secs=>ttl_seconds),resends=resends+1,send_state='ready' WHERE id=c.id;
 PERFORM private.rlnext_record(a.tenant_id,a.id,NULL,'code_resent');
 RETURN jsonb_build_object('ready',true);
END $$;
CREATE FUNCTION public.rlnext_verify(_id uuid,_receipt_hash text,_otp_hash text,_reset_hash text,_reset_expires bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.rlnext_challenges; a private.rlnext_accounts;
BEGIN
 PERFORM private.rlnext_service(); SELECT * INTO c FROM private.rlnext_challenges WHERE id=_id AND receipt_hash=_receipt_hash FOR UPDATE;
 IF c.id IS NULL THEN RETURN jsonb_build_object('valid',false); END IF;
 SELECT * INTO STRICT a FROM private.rlnext_accounts WHERE id=c.account_id FOR UPDATE;
 IF c.verify_state<>'ready' OR c.used_at IS NOT NULL OR c.expires_at<=clock_timestamp() OR c.attempts>=c.max_attempts OR c.send_state NOT IN('accepted','uncertain') OR NOT private.rlnext_domain(a.tenant_id,a.email)
 OR NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=a.user_id AND lower(u.email)=a.email AND (c.purpose='verify' OR u.email_confirmed_at IS NOT NULL))
 OR (c.purpose='verify' AND (a.status<>'pending_verification' OR a.user_id IS NULL)) OR (c.purpose='unlock' AND a.status<>'locked') OR (c.purpose='password_reset' AND a.status NOT IN('active','locked'))
 THEN RETURN jsonb_build_object('valid',false); END IF;
 UPDATE private.rlnext_challenges SET attempts=attempts+1 WHERE id=c.id;
 IF c.otp_hash<>_otp_hash THEN
   UPDATE private.rlnext_challenges SET verify_state=CASE WHEN attempts>=max_attempts THEN 'exhausted' ELSE 'ready' END WHERE id=c.id;
   PERFORM private.rlnext_record(a.tenant_id,a.id,NULL,'code_rejected'); RETURN jsonb_build_object('valid',false);
 END IF;
 UPDATE private.rlnext_challenges SET used_at=clock_timestamp(),verify_state=CASE WHEN purpose='verify' THEN 'claimed' ELSE 'complete' END,
   reset_hash=CASE WHEN purpose='verify' THEN NULL ELSE _reset_hash END,reset_state=CASE WHEN purpose='verify' THEN 'none' ELSE 'ready' END,reset_expires_at=CASE WHEN _reset_expires IS NULL THEN clock_timestamp()+interval '15 minutes' ELSE to_timestamp(_reset_expires::double precision/1000) END WHERE id=c.id;
 IF c.purpose<>'verify' THEN
   UPDATE private.rlnext_accounts SET reset_required=true,version=version+1 WHERE id=a.id;
   PERFORM private.rlnext_record(a.tenant_id,a.id,NULL,'email_proof_accepted');
 END IF;
 RETURN jsonb_build_object('valid',true,'user_id',a.user_id);
END $$;
CREATE FUNCTION public.rlnext_verify_finish(_id uuid,_confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.rlnext_challenges; a private.rlnext_accounts;
BEGIN
 PERFORM private.rlnext_service(); SELECT * INTO STRICT c FROM private.rlnext_challenges WHERE id=_id FOR UPDATE;
 SELECT * INTO STRICT a FROM private.rlnext_accounts WHERE id=c.account_id FOR UPDATE;
 IF c.purpose<>'verify' OR c.verify_state<>'claimed' THEN RETURN jsonb_build_object('held',true); END IF;
 -- Current Auth readback, rather than a boolean response, proves confirmation.
 IF EXISTS(SELECT 1 FROM auth.users WHERE id=a.user_id AND lower(email)=a.email AND email_confirmed_at IS NOT NULL) AND private.rlnext_domain(a.tenant_id,a.email) THEN
   UPDATE private.rlnext_accounts SET status='pending_approval',verified_at=clock_timestamp(),version=version+1 WHERE id=a.id;
   UPDATE private.rlnext_challenges SET verify_state='complete' WHERE id=c.id;
   PERFORM private.rlnext_record(a.tenant_id,a.id,a.user_id,'email_verified');
   PERFORM private.rlnext_notice(a.id,'pending_approval',NULL,true);
   RETURN jsonb_build_object('status','pending_approval');
 END IF;
 RETURN jsonb_build_object('held',true);
END $$;
CREATE FUNCTION public.rlnext_reset_claim(_id uuid,_receipt_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.rlnext_challenges; a private.rlnext_accounts; pw text;
BEGIN
 PERFORM private.rlnext_service(); SELECT * INTO c FROM private.rlnext_challenges WHERE id=_id AND reset_hash=_receipt_hash FOR UPDATE;
 IF c.id IS NULL THEN RETURN '{}'::jsonb; END IF;
 IF c.reset_state='complete' THEN RETURN jsonb_build_object('completed',true); END IF;
 SELECT * INTO STRICT a FROM private.rlnext_accounts WHERE id=c.account_id FOR UPDATE;
 IF c.reset_state<>'ready' OR c.reset_expires_at<=clock_timestamp() OR a.status NOT IN('active','locked') OR NOT a.reset_required OR NOT private.rlnext_domain(a.tenant_id,a.email)
 OR public.is_platform_admin(a.user_id) OR EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id=a.user_id AND tenant_id<>a.tenant_id)
 THEN RETURN '{}'::jsonb; END IF;
 SELECT md5(encrypted_password) INTO pw FROM auth.users WHERE id=a.user_id AND lower(email)=a.email AND email_confirmed_at IS NOT NULL;
 IF pw IS NULL THEN RETURN '{}'::jsonb; END IF;
 UPDATE private.rlnext_challenges SET reset_state='claimed',password_before=pw WHERE id=c.id;
 RETURN jsonb_build_object('user_id',a.user_id);
END $$;
CREATE FUNCTION public.rlnext_reset_finish(_id uuid,_provider_ok boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.rlnext_challenges; a private.rlnext_accounts;
BEGIN
 PERFORM private.rlnext_service(); SELECT * INTO STRICT c FROM private.rlnext_challenges WHERE id=_id FOR UPDATE;
 SELECT * INTO STRICT a FROM private.rlnext_accounts WHERE id=c.account_id FOR UPDATE;
 IF c.reset_state='complete' THEN RETURN jsonb_build_object('completed',true); END IF;
 IF c.reset_state NOT IN('claimed','uncertain') OR a.status NOT IN('active','locked') OR NOT private.rlnext_domain(a.tenant_id,a.email) THEN RETURN jsonb_build_object('completed',false); END IF;
 -- No password hash returned. A changed provider-owned password is required even on lost response.
 IF EXISTS(SELECT 1 FROM auth.users WHERE id=a.user_id AND lower(email)=a.email AND md5(encrypted_password) IS DISTINCT FROM c.password_before AND encrypted_password IS NOT NULL)
 THEN
   UPDATE auth.users SET banned_until=NULL WHERE id=a.user_id AND banned_until>clock_timestamp();
   UPDATE private.rlnext_accounts SET status='active',reset_required=false,provider_locked=false,lock_reason=NULL,locked_at=NULL,version=version+1 WHERE id=a.id;
   UPDATE private.rlnext_challenges SET reset_state='complete',password_before=NULL WHERE id=c.id;
   PERFORM private.rlnext_record(a.tenant_id,a.id,NULL,'password_reset');
   PERFORM private.rlnext_notice(a.id,'reset_completed');
   IF c.purpose='unlock' THEN PERFORM private.rlnext_notice(a.id,'unlocked'); END IF;
   RETURN jsonb_build_object('completed',true);
 END IF;
 UPDATE private.rlnext_challenges SET reset_state='uncertain' WHERE id=c.id;
 RETURN jsonb_build_object('completed',false);
END $$;

CREATE FUNCTION private.rlnext_scope(_tenant uuid,_bu uuid,_groups uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE snapshot jsonb; group_snapshot jsonb;
BEGIN
 IF cardinality(_groups) NOT BETWEEN 1 AND 20 OR cardinality(_groups)<>(SELECT count(DISTINCT x) FROM unnest(_groups) x) OR NOT EXISTS(SELECT 1 FROM public.business_units WHERE id=_bu AND tenant_id=_tenant AND NOT is_archived)
 OR EXISTS(SELECT 1 FROM unnest(_groups) x LEFT JOIN public.tenant_groups g ON g.id=x AND g.tenant_id=_tenant AND g.bu_id=_bu WHERE g.id IS NULL)
 THEN RAISE EXCEPTION 'Current tenant BU and groups required' USING ERRCODE='42501'; END IF;
 -- Mirror the reviewed governance scope rules without calling its workspace-
 -- requester guard (a newly approved user has no workspace membership yet).
 IF EXISTS(SELECT 1 FROM public.tenant_group_roles gr JOIN public.rbac_roles r ON r.id=gr.role_id WHERE gr.group_id=ANY(_groups)
   AND (NOT r.is_assignable OR (r.tenant_id IS NOT NULL AND r.tenant_id<>_tenant) OR r.key ~* '(admin|owner|platform|system)' OR r.key NOT IN('tenant_analyst','tenant_viewer') AND r.is_system))
 OR EXISTS(SELECT 1 FROM public.bu_group_assignments WHERE group_id=ANY(_groups) AND (tenant_id<>_tenant OR role::text='bu_admin'))
 OR EXISTS(SELECT 1 FROM public.recon_definition_bu_grants WHERE principal_type='group' AND principal_id=ANY(_groups) AND tenant_id<>_tenant)
 OR EXISTS(SELECT 1 FROM public.recon_permissions p JOIN public.recon_definitions d ON d.id=p.recon_id WHERE p.principal_type='group' AND p.principal_id=ANY(_groups) AND d.tenant_id<>_tenant)
 OR EXISTS(SELECT 1 FROM public.data_resource_registry_grants WHERE principal_type='group' AND principal_group_id=ANY(_groups) AND tenant_id<>_tenant)
 OR EXISTS(SELECT 1 FROM public.data_resource_bu_grants WHERE principal_type='group' AND principal_id=ANY(_groups) AND tenant_id<>_tenant)
 THEN RAISE EXCEPTION 'Privileged or cross-tenant group scope unavailable' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object(
   'groups',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.id) FROM public.tenant_groups g WHERE id=ANY(_groups)),'[]'::jsonb),
   'roles',coalesce((SELECT jsonb_agg(jsonb_build_object('group_id',gr.group_id,'role',to_jsonb(r)) ORDER BY gr.group_id,r.id) FROM public.tenant_group_roles gr JOIN public.rbac_roles r ON r.id=gr.role_id WHERE gr.group_id=ANY(_groups)),'[]'::jsonb),
   'permissions',coalesce((SELECT jsonb_agg(jsonb_build_object('group_id',gr.group_id,'permission',to_jsonb(p)) ORDER BY gr.group_id,p.id) FROM public.tenant_group_roles gr JOIN public.rbac_role_permissions rp ON rp.role_id=gr.role_id JOIN public.permissions p ON p.id=rp.permission_id WHERE gr.group_id=ANY(_groups)),'[]'::jsonb),
   'bu_assignments',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.group_id,g.bu_id) FROM public.bu_group_assignments g WHERE group_id=ANY(_groups)),'[]'::jsonb),
   'reconciliation_grants',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.id) FROM public.recon_definition_bu_grants g WHERE principal_type='group' AND principal_id=ANY(_groups)),'[]'::jsonb),
   'legacy_reconciliation_grants',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.id) FROM public.recon_permissions g WHERE principal_type='group' AND principal_id=ANY(_groups)),'[]'::jsonb),
   'data_resource_grants',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.id) FROM public.data_resource_registry_grants g WHERE principal_type='group' AND principal_group_id=ANY(_groups)),'[]'::jsonb),
   'legacy_data_resource_grants',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.id) FROM public.data_resource_bu_grants g WHERE principal_type='group' AND principal_id=ANY(_groups)),'[]'::jsonb)
 ) INTO group_snapshot;
 snapshot:=jsonb_build_object('bu_id',_bu,'groups',group_snapshot,'scope','Existing group roles, permissions, department/team/feature and workspace rights apply; no new role definition is created.');
 RETURN jsonb_build_object('snapshot',snapshot,'hash',encode(extensions.digest(snapshot::text,'sha256'),'hex'));
END $$;

CREATE FUNCTION public.rlnext_admin(_tenant uuid,_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; action text:=_command->>'action'; a private.rlnext_accounts; row_id uuid; ids uuid[]; vers integer[];
 result jsonb; rows jsonb; counts jsonb; off integer:=greatest(0,coalesce((_command->>'offset')::integer,0)); search text:=left(coalesce(_command->>'search',''),120);
 reason text:=_command->>'reason'; operation text:=_command->>'operation'; n integer; bu uuid; groups uuid[]; scope jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('rlnext:'||_tenant::text,0));
 actor:=private.rlnext_admin_current(_tenant);
 IF _command->>'tenantId' IS DISTINCT FROM _tenant::text THEN RAISE EXCEPTION 'Tenant mismatch' USING ERRCODE='42501'; END IF;
 IF action='list' THEN
   WITH users AS (
     SELECT coalesce(ac.id,u.id) id,u.id user_id,u.email,coalesce(ac.first_name,u.raw_user_meta_data->>'first_name',u.raw_user_meta_data->>'full_name','') first_name,coalesce(ac.last_name,'') last_name,
       coalesce(ac.department,'') department,coalesce(ac.employee_id,'') employee_id,coalesce(ac.job_title,'') job_title,CASE WHEN u.banned_until>clock_timestamp() THEN 'locked' ELSE coalesce(ac.status,'active') END status,coalesce(ac.version,1) version,
       coalesce(ac.requested_at,u.created_at) requested_at,ac.verified_at,u.last_sign_in_at last_login,coalesce(ac.lock_reason,CASE WHEN u.banned_until>clock_timestamp() THEN 'Supabase account restriction' END) lock_reason,coalesce(ac.locked_at,CASE WHEN u.banned_until>clock_timestamp() THEN u.updated_at END) locked_at,coalesce(ac.assigned,true) assigned
     FROM auth.users u JOIN public.tenant_members m ON m.user_id=u.id AND m.tenant_id=_tenant LEFT JOIN private.rlnext_accounts ac ON ac.user_id=u.id AND ac.tenant_id=_tenant
     UNION ALL
     SELECT ac.id,ac.user_id,ac.email,ac.first_name,ac.last_name,ac.department,ac.employee_id,ac.job_title,ac.status,ac.version,ac.requested_at,ac.verified_at,u.last_sign_in_at,ac.lock_reason,ac.locked_at,ac.assigned
     FROM private.rlnext_accounts ac LEFT JOIN auth.users u ON u.id=ac.user_id WHERE ac.tenant_id=_tenant AND NOT EXISTS(SELECT 1 FROM public.tenant_members m WHERE m.tenant_id=_tenant AND m.user_id=ac.user_id)
   ), filtered AS(SELECT * FROM users WHERE (coalesce(_command->>'status','all')='all' OR status=_command->>'status') AND position(lower(search) IN lower(email||' '||first_name||' '||last_name))>0)
   SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(f)) FROM(SELECT * FROM filtered ORDER BY requested_at DESC,id LIMIT 50 OFFSET off) f),'[]'::jsonb),
     'total',(SELECT count(*) FROM filtered),'counts',coalesce((SELECT jsonb_object_agg(status,num) FROM(SELECT status,count(*) num FROM users GROUP BY status) c),'{}'::jsonb)) INTO result;
   RETURN result;
 ELSIF action='audit' THEN
   SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO rows FROM(SELECT id,account_id,actor_id,event,occurred_at,reason,context FROM private.rlnext_audit WHERE tenant_id=_tenant AND (_command->>'accountId' IS NULL OR account_id=(_command->>'accountId')::uuid) ORDER BY occurred_at DESC,id LIMIT 50 OFFSET off) r;
   RETURN jsonb_build_object('rows',rows);
 ELSIF action='invite_meta' THEN
   RETURN jsonb_build_object('slug',(SELECT slug FROM public.tenants WHERE id=_tenant));
 ELSIF action='domains' THEN
   RETURN jsonb_build_object('domains',coalesce((SELECT jsonb_agg(jsonb_build_object('domain',domain::text,'status',status,'verified_at',verified_at)) FROM public.tenant_email_domains WHERE tenant_id=_tenant),'[]'::jsonb),
     'policy',coalesce((SELECT to_jsonb(p) FROM private.rlnext_policy p WHERE tenant_id=_tenant),jsonb_build_object('enabled',false,'allowed_domains','[]'::jsonb,'blocked_domains',ARRAY['gmail.com','yahoo.com','outlook.com'],'ttl_seconds',600,'max_resends',3,'max_attempts',5,'failed_login_limit',5)));
 ELSIF action='options' THEN
   IF _command->>'kind'='bu' THEN
     SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO rows FROM(SELECT id,name FROM public.business_units WHERE tenant_id=_tenant AND NOT is_archived AND position(lower(search) IN lower(name))>0 ORDER BY name,id LIMIT 50 OFFSET off) r;
   ELSIF _command->>'kind'='group' THEN
     SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO rows FROM(SELECT id,name FROM public.tenant_groups WHERE tenant_id=_tenant AND bu_id=(_command->>'buId')::uuid AND position(lower(search) IN lower(name))>0 ORDER BY name,id LIMIT 50 OFFSET off) r;
   ELSE RAISE EXCEPTION 'Invalid selector' USING ERRCODE='22023'; END IF;
   RETURN jsonb_build_object('rows',rows);
 ELSIF action='scope' THEN
   SELECT array_agg(x::uuid) INTO groups FROM jsonb_array_elements_text(_command->'groupIds') x;
   RETURN private.rlnext_scope(_tenant,(_command->>'buId')::uuid,groups);
 END IF;
 IF _command->>'confirmation' IS DISTINCT FROM 'true' OR reason IS NULL OR length(trim(reason)) NOT BETWEEN 3 AND 800 THEN RAISE EXCEPTION 'Confirmation and reason required' USING ERRCODE='22023'; END IF;
 -- Lock dependencies in a single stable order, before decision or assignment.
 LOCK TABLE public.tenant_members,public.tenant_email_domains,public.business_units,public.tenant_groups IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.tenant_group_members,public.tenant_group_roles,public.rbac_roles,public.rbac_role_permissions,public.permissions,public.bu_group_assignments,
   public.recon_definition_bu_grants,public.recon_permissions,public.recon_definitions,public.data_resource_registry_grants,public.data_resource_bu_grants IN SHARE ROW EXCLUSIVE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended('rlnext:'||_tenant::text,0));
 actor:=private.rlnext_admin_current(_tenant);
 IF action='invite' THEN
   IF NOT private.rlnext_domain(_tenant,_command->>'email') OR _command->>'tokenHash' !~ '^[a-f0-9]{64}$' OR (_command->>'expires')::bigint IS NULL OR to_timestamp((_command->>'expires')::double precision/1000)<=clock_timestamp() OR to_timestamp((_command->>'expires')::double precision/1000)>clock_timestamp()+interval '24 hours 5 seconds' THEN RAISE EXCEPTION 'Invalid enrollment permit' USING ERRCODE='22023'; END IF;
   INSERT INTO private.rlnext_invitations(token_hash,tenant_id,email,expires_at,created_by) VALUES(_command->>'tokenHash',_tenant,lower(_command->>'email'),to_timestamp((_command->>'expires')::double precision/1000),actor);
   PERFORM private.rlnext_record(_tenant,NULL,actor,'enrollment_permit_created',reason);
   RETURN jsonb_build_object('created',true);
 END IF;
 IF action='policy' THEN
   IF (_command->>'ttlSeconds')::integer NOT BETWEEN 120 AND 1800 OR (_command->>'maxResends')::integer NOT BETWEEN 0 AND 5 OR (_command->>'maxAttempts')::integer NOT BETWEEN 1 AND 10 OR (_command->>'failedLoginLimit')::integer NOT BETWEEN 3 AND 20 THEN RAISE EXCEPTION 'Invalid policy' USING ERRCODE='22023'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(_command->'allowedDomains','[]'::jsonb)) x WHERE NOT EXISTS(SELECT 1 FROM public.tenant_email_domains WHERE tenant_id=_tenant AND domain::text=x AND status='verified')) THEN RAISE EXCEPTION 'Only current verified tenant domains may be allowed' USING ERRCODE='42501'; END IF;
   INSERT INTO private.rlnext_policy(tenant_id,enabled,allowed_domains,blocked_domains,ttl_seconds,max_resends,max_attempts,failed_login_limit)
   VALUES(_tenant,(_command->>'enabled')::boolean,ARRAY(SELECT lower(x) FROM jsonb_array_elements_text(coalesce(_command->'allowedDomains','[]'::jsonb)) x),ARRAY(SELECT lower(x) FROM jsonb_array_elements_text(_command->'blockedDomains') x),(_command->>'ttlSeconds')::integer,(_command->>'maxResends')::integer,(_command->>'maxAttempts')::integer,(_command->>'failedLoginLimit')::integer)
   ON CONFLICT(tenant_id) DO UPDATE SET enabled=excluded.enabled,allowed_domains=excluded.allowed_domains,blocked_domains=excluded.blocked_domains,ttl_seconds=excluded.ttl_seconds,max_resends=excluded.max_resends,max_attempts=excluded.max_attempts,failed_login_limit=excluded.failed_login_limit;
   PERFORM private.rlnext_record(_tenant,NULL,actor,'domain_policy_changed',reason);
   RETURN jsonb_build_object('saved',true);
 END IF;
 IF action='decide' THEN
   SELECT array_agg(x::uuid) INTO ids FROM jsonb_array_elements_text(_command->'accountIds') x;
   SELECT array_agg(x::integer) INTO vers FROM jsonb_array_elements_text(_command->'versions') x;
   IF cardinality(ids) NOT BETWEEN 1 AND 20 OR cardinality(ids)<>cardinality(vers) OR cardinality(ids)<>(SELECT count(DISTINCT x) FROM unnest(ids) x) OR _command->>'decision' NOT IN('approve','reject') THEN RAISE EXCEPTION 'Invalid decision' USING ERRCODE='22023'; END IF;
   -- Atomic bounded bulk; one stale/revoked/wrong-tenant row refuses the entire packet.
   PERFORM 1 FROM private.rlnext_accounts WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
   FOR n IN 1..cardinality(ids) LOOP
     SELECT * INTO a FROM private.rlnext_accounts WHERE id=ids[n] AND tenant_id=_tenant;
     IF a.id IS NULL OR a.status<>'pending_approval' OR a.version IS DISTINCT FROM vers[n] OR a.user_id=actor OR public.is_platform_admin(a.user_id) OR NOT private.rlnext_domain(_tenant,a.email)
       OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=a.user_id AND email_confirmed_at IS NOT NULL AND lower(email)=a.email)
       OR EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id=a.user_id) THEN RAISE EXCEPTION 'Approval changed or unavailable' USING ERRCODE='PT409'; END IF;
     UPDATE private.rlnext_accounts SET status=CASE WHEN _command->>'decision'='approve' THEN 'active' ELSE 'rejected' END,version=version+1,decided_at=clock_timestamp(),decided_by=actor WHERE id=a.id;
     PERFORM private.rlnext_record(_tenant,a.id,actor,CASE WHEN _command->>'decision'='approve' THEN 'approved' ELSE 'rejected' END,reason);
     PERFORM private.rlnext_notice(a.id,CASE WHEN _command->>'decision'='approve' THEN 'approved' ELSE 'rejected' END,reason);
     PERFORM private.rlnext_notice(a.id,CASE WHEN _command->>'decision'='approve' THEN 'admin_approved' ELSE 'admin_rejected' END,NULL,true);
   END LOOP;
   RETURN jsonb_build_object('changed',cardinality(ids));
 END IF;
 row_id:=(_command->>'accountId')::uuid;
 SELECT * INTO a FROM private.rlnext_accounts WHERE id=row_id AND tenant_id=_tenant FOR UPDATE;
 IF a.id IS NULL AND action='manage' THEN
   INSERT INTO private.rlnext_accounts(id,tenant_id,user_id,email,status,verified_at,assigned)
   SELECT u.id,_tenant,u.id,lower(u.email),CASE WHEN u.banned_until>clock_timestamp() THEN 'locked' ELSE 'active' END,u.email_confirmed_at,true FROM auth.users u JOIN public.tenant_members m ON m.user_id=u.id AND m.tenant_id=_tenant WHERE u.id=row_id AND m.active
   RETURNING * INTO a;
 END IF;
 IF a.id IS NOT NULL AND a.status='active' AND EXISTS(SELECT 1 FROM auth.users WHERE id=a.user_id AND banned_until>clock_timestamp()) THEN UPDATE private.rlnext_accounts SET status='locked',provider_locked=true WHERE id=a.id RETURNING * INTO a; END IF;
 IF a.id IS NULL OR a.user_id IS NULL OR a.user_id=actor OR public.is_platform_admin(a.user_id) OR a.version IS DISTINCT FROM (_command->>'version')::integer
   OR EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id=a.user_id AND tenant_id<>_tenant)
 THEN RAISE EXCEPTION 'Account changed or unavailable' USING ERRCODE='PT409'; END IF;
 IF action='assign' THEN
   bu:=(_command->>'buId')::uuid; SELECT array_agg(x::uuid) INTO groups FROM jsonb_array_elements_text(_command->'groupIds') x;
   IF a.status<>'active' OR a.assigned OR NOT private.rlnext_domain(_tenant,a.email) OR EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id=a.user_id) THEN RAISE EXCEPTION 'Assignment unavailable' USING ERRCODE='PT409'; END IF;
   scope:=private.rlnext_scope(_tenant,bu,groups);
   IF scope->>'hash' IS DISTINCT FROM _command->>'scopeHash' THEN RAISE EXCEPTION 'Group scope changed; review again' USING ERRCODE='PT409'; END IF;
   INSERT INTO public.tenant_members(tenant_id,user_id,role,invited_by) VALUES(_tenant,a.user_id,'tenant_viewer',actor);
   INSERT INTO public.tenant_group_members(group_id,user_id,added_by) SELECT unnest(groups),a.user_id,actor;
   UPDATE private.rlnext_accounts SET assigned=true,version=version+1 WHERE id=a.id;
   PERFORM private.rlnext_record(_tenant,a.id,actor,'assigned',reason,scope->'snapshot'); PERFORM private.rlnext_notice(a.id,'assigned');
   RETURN jsonb_build_object('assigned',true);
 ELSIF action='manage' THEN
   IF operation IN('unlock','reactivate','reset_password') AND (NOT private.rlnext_domain(_tenant,a.email) OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=a.user_id AND lower(email)=a.email AND email_confirmed_at IS NOT NULL)) THEN RAISE EXCEPTION 'Current tenant email verification required' USING ERRCODE='PT409'; END IF;
   IF operation='reset_password' THEN
     IF a.status NOT IN('active','locked') THEN RAISE EXCEPTION 'Reset unavailable' USING ERRCODE='PT409'; END IF;
     -- Administrator asks the user to complete proof, never sets or sees their password.
     PERFORM private.rlnext_notice(a.id,'password_reset',reason); PERFORM private.rlnext_record(_tenant,a.id,actor,'reset_requested_by_admin',reason);
     RETURN jsonb_build_object('requested',true);
   END IF;
   IF NOT((a.status='active' AND operation IN('lock','disable','suspend')) OR (a.status='locked' AND operation IN('unlock','disable','suspend')) OR (a.status IN('disabled','suspended') AND operation='reactivate')) THEN RAISE EXCEPTION 'Account state changed' USING ERRCODE='PT409'; END IF;
   UPDATE private.rlnext_accounts SET status=CASE operation WHEN 'lock' THEN 'locked' WHEN 'disable' THEN 'disabled' WHEN 'suspend' THEN 'suspended' ELSE 'active' END,
     lock_reason=CASE WHEN operation='lock' THEN reason ELSE NULL END,locked_at=CASE WHEN operation='lock' THEN clock_timestamp() ELSE NULL END,reset_required=false,version=version+1 WHERE id=a.id;
   IF operation IN('unlock','reactivate') THEN UPDATE auth.users SET banned_until=NULL WHERE id=a.user_id AND banned_until>clock_timestamp(); END IF;
   -- Any admin state change invalidates outstanding recovery proof.
   UPDATE private.rlnext_challenges SET verify_state='exhausted',reset_state='none',reset_hash=NULL WHERE account_id=a.id AND reset_state<>'complete';
   PERFORM private.rlnext_record(_tenant,a.id,actor,operation,reason);
   PERFORM private.rlnext_notice(a.id,CASE operation WHEN 'lock' THEN 'locked' WHEN 'unlock' THEN 'unlocked' WHEN 'disable' THEN 'disabled' WHEN 'suspend' THEN 'suspended' ELSE 'approved' END,reason);
   IF operation='lock' THEN PERFORM private.rlnext_notice(a.id,'locked',NULL,true); END IF;
   RETURN jsonb_build_object('changed',true);
 END IF;
 RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023';
END $$;

CREATE FUNCTION public.rlnext_login_status() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a private.rlnext_accounts; actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM private.rlnext_accounts WHERE user_id=actor;
 IF a.id IS NULL THEN RETURN jsonb_build_object('allowed',true,'status','active','reset_required',false,'message',''); END IF;
 IF a.status='active' AND NOT a.reset_required THEN
   PERFORM private.rlnext_record(a.tenant_id,a.id,actor,'login');
 ELSE PERFORM private.rlnext_record(a.tenant_id,a.id,actor,'login_blocked'); END IF;
 RETURN jsonb_build_object('allowed',a.status='active' AND NOT a.reset_required,'status',a.status,'reset_required',a.reset_required,
 'tenant',(SELECT slug FROM public.tenants WHERE id=a.tenant_id),'message',CASE a.status WHEN 'pending_approval' THEN 'Your account is awaiting administrator approval.' WHEN 'pending_verification' THEN 'Verify your email before signing in.' WHEN 'locked' THEN 'Account locked. Use Unlock Account to verify your email and reset your password.' WHEN 'active' THEN CASE WHEN a.reset_required THEN 'Complete your password reset before signing in.' ELSE '' END ELSE 'Your account is unavailable. Contact your tenant administrator.' END);
END $$;
CREATE FUNCTION public.rlnext_notice_claim(_limit integer DEFAULT 10) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item private.rlnext_notices; output jsonb:='[]'::jsonb; recipient text; slug text;
BEGIN
 PERFORM private.rlnext_service();
 FOR item IN SELECT * FROM private.rlnext_notices WHERE state='ready' ORDER BY created_at,id LIMIT least(10,greatest(1,_limit)) FOR UPDATE SKIP LOCKED LOOP
   SELECT lower(email) INTO recipient FROM auth.users WHERE id=item.recipient_id AND email_confirmed_at IS NOT NULL;
   IF recipient IS NULL OR (item.event IN('pending_approval','failed_login','admin_approved','admin_rejected') AND NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=item.tenant_id AND user_id=item.recipient_id AND active AND role::text='tenant_admin')) OR (item.event NOT IN('pending_approval','failed_login','admin_approved','admin_rejected') AND NOT EXISTS(SELECT 1 FROM private.rlnext_accounts ac WHERE ac.id=item.account_id AND ac.email=recipient AND ac.user_id=item.recipient_id AND private.rlnext_domain(ac.tenant_id,recipient))) THEN
     UPDATE private.rlnext_notices SET state='rejected' WHERE id=item.id; CONTINUE;
   END IF;
   SELECT t.slug INTO slug FROM public.tenants t WHERE id=item.tenant_id;
   item.lease:=gen_random_uuid(); UPDATE private.rlnext_notices SET state='claimed',lease=item.lease,claimed_at=clock_timestamp() WHERE id=item.id;
   output:=output||jsonb_build_array(jsonb_build_object('id',item.id,'lease',item.lease,'to',recipient,'slug',slug,'event',item.event,'reason',item.reason));
 END LOOP;
 RETURN output;
END $$;
CREATE FUNCTION public.rlnext_notice_settle(_id uuid,_lease uuid,_state text,_provider_ref text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM private.rlnext_service();
 IF _state NOT IN('accepted','rejected','uncertain') OR (_provider_ref IS NOT NULL AND (_provider_ref !~ '^[A-Za-z0-9_.:-]{1,200}$' OR _provider_ref ~* '(sb_secret_|sb_publishable_|zoho-enczapikey)' OR _provider_ref ~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')) THEN RAISE EXCEPTION 'Invalid receipt' USING ERRCODE='22023'; END IF;
 UPDATE private.rlnext_notices SET state=_state,provider_ref=_provider_ref WHERE id=_id AND lease=_lease AND state='claimed';
 RETURN FOUND;
END $$;

CREATE FUNCTION private.rlnext_account_allowed(_user uuid,_tenant uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM private.rlnext_accounts WHERE user_id=_user AND (_tenant IS NULL OR tenant_id=_tenant) AND (status<>'active' OR reset_required OR EXISTS(SELECT 1 FROM auth.users u WHERE u.id=_user AND u.banned_until>now())))
$$;
-- A restrictive policy composes with existing RLS; it grants no access itself.
-- Parent guards the exact affected table/ACL/policy inventory before applying.
DO $$ DECLARE rel record; BEGIN
 FOR rel IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN('r','p') AND c.relrowsecurity AND c.relname NOT LIKE 'mkt_%' AND c.relname NOT LIKE 'marketing_%' AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND NOT a.attisdropped AND a.atttypid='uuid'::regtype)
 LOOP EXECUTE format('CREATE POLICY rlnext_account_lifecycle ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING(private.rlnext_account_allowed(auth.uid(),tenant_id)) WITH CHECK(private.rlnext_account_allowed(auth.uid(),tenant_id))',rel.relname); END LOOP;
END $$;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.rlnext_account_allowed(uuid,uuid) TO authenticated;
-- Existing sessions/MFA are retained. New session creation is denied for managed
-- locked/disabled/pending users, including direct Auth password sign-in bypasses.
CREATE FUNCTION private.rlnext_session_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN IF NOT private.rlnext_account_allowed(NEW.user_id,NULL) THEN RAISE EXCEPTION 'Account lifecycle prevents sign-in' USING ERRCODE='42501'; END IF; RETURN NEW; END $$;
CREATE TRIGGER rlnext_session_gate BEFORE INSERT ON auth.sessions FOR EACH ROW EXECUTE FUNCTION private.rlnext_session_gate();
-- An in-flight proof cannot overwrite a newly disabled/suspended account.
-- Password writes from the current ordinary profile flow remain unchanged for active users.
CREATE FUNCTION private.rlnext_password_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a private.rlnext_accounts;
BEGIN
 IF NEW.encrypted_password IS NOT DISTINCT FROM OLD.encrypted_password THEN RETURN NEW; END IF;
 SELECT * INTO a FROM private.rlnext_accounts WHERE user_id=NEW.id FOR UPDATE;
 IF a.id IS NULL THEN RETURN NEW; END IF;
 IF a.status IN('disabled','suspended','rejected','pending_approval') OR (a.status='locked' AND NOT EXISTS(SELECT 1 FROM private.rlnext_challenges WHERE account_id=a.id AND reset_state='claimed' AND reset_expires_at>clock_timestamp()))
 THEN RAISE EXCEPTION 'Password update is unavailable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rlnext_password_gate BEFORE UPDATE OF encrypted_password ON auth.users FOR EACH ROW EXECUTE FUNCTION private.rlnext_password_gate();
-- Failures are accepted only by the existing verified server capture adapter;
-- browser telemetry cannot lock an account or manufacture a failed-login email.
CREATE FUNCTION private.rlnext_verified_login_event(_request_id uuid,_user_id uuid,_outcome text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a private.rlnext_accounts; threshold integer; total integer;
BEGIN
 PERFORM private.rlnext_service();
 IF _outcome NOT IN('success','invalid_credentials','mfa_invalid','account_locked') THEN RETURN false; END IF;
 SELECT * INTO a FROM private.rlnext_accounts WHERE user_id=_user_id FOR UPDATE;
 IF a.id IS NULL THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM private.rlnext_audit WHERE account_id=a.id AND context->>'request_id'=_request_id::text) THEN RETURN true; END IF;
 PERFORM private.rlnext_record(a.tenant_id,a.id,a.user_id,CASE WHEN _outcome='success' THEN 'login' ELSE 'failed_login' END,NULL,jsonb_build_object('request_id',_request_id));
 SELECT failed_login_limit INTO threshold FROM private.rlnext_policy WHERE tenant_id=a.tenant_id;
 SELECT count(*) INTO total FROM private.rlnext_audit WHERE account_id=a.id AND event='failed_login' AND occurred_at>clock_timestamp()-interval '15 minutes' AND occurred_at>coalesce((SELECT max(occurred_at) FROM private.rlnext_audit WHERE account_id=a.id AND event='login'),'-infinity'::timestamptz);
 IF total>=coalesce(threshold,5) AND a.status='active' AND NOT public.is_platform_admin(a.user_id) AND NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id=a.user_id AND tenant_id<>a.tenant_id) THEN
   UPDATE private.rlnext_accounts SET status='locked',locked_at=clock_timestamp(),lock_reason='Multiple unsuccessful sign-in attempts',version=version+1 WHERE id=a.id;
   PERFORM private.rlnext_record(a.tenant_id,a.id,NULL,'locked'); PERFORM private.rlnext_notice(a.id,'locked'); PERFORM private.rlnext_notice(a.id,'failed_login',NULL,true);
 END IF;
 RETURN true;
END $$;
-- Exact grants; private helper execution is revoked after all function creation.
DO $$ DECLARE fn record; BEGIN
 FOR fn IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname LIKE 'rlnext_%'
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',fn.signature); END LOOP;
 FOR fn IN SELECT p.oid::regprocedure signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'rlnext_%'
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',fn.signature);
 IF fn.proname IN('rlnext_admin','rlnext_login_status') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',fn.signature);
 ELSE EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn.signature); END IF;
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION private.rlnext_account_allowed(uuid,uuid) TO authenticated;

-- END INPUT: Frozen lifecycle

-- BEGIN INPUT: Original permission-body overlay
-- Apply only AFTER lifecycle-proposal, inside the same parent-guarded transaction.
-- Preserve existing helper OIDs/owners/ACL/config/ABI. Clone the exact reviewed
-- body privately, then add a lifecycle deny before invoking that original body.
DO $$
DECLARE fn record; definition text; clone_definition text; body text; call_args text;
 clone_name text; language_name text; gate text; actor_arg text; tenant_arg text;
 before_owner oid; before_acl aclitem[]; before_config text[];
BEGIN
 FOR fn IN SELECT p.*,n.nspname,l.lanname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE p.prosecdef AND p.prorettype='boolean'::regtype AND NOT p.proretset AND p.provariadic=0
 AND (n.nspname='private' AND p.proname IN('is_tenant_member','has_tenant_role','user_has_tenant_role_or_group','user_can_access_recon')
 OR n.nspname='public' AND p.proname IN('has_permission','user_has_permission','has_permission_abac','user_can_access_recon'))
 ORDER BY n.nspname,p.proname,p.oid
 LOOP
  IF fn.lanname NOT IN('sql','plpgsql') OR fn.proargnames IS NULL OR cardinality(fn.proargnames)<>fn.pronargs THEN RAISE EXCEPTION 'Unsupported authorization helper ABI' USING ERRCODE='PT409'; END IF;
  definition:=pg_get_functiondef(fn.oid); before_owner:=fn.proowner; before_acl:=fn.proacl; before_config:=fn.proconfig;
  clone_name:='rlnext_base_'||fn.nspname||'_'||fn.proname;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname=clone_name) THEN RAISE EXCEPTION 'Authorization clone already exists' USING ERRCODE='PT409'; END IF;
  clone_definition:=replace(definition,'FUNCTION '||fn.nspname||'.'||fn.proname||'(','FUNCTION private.'||clone_name||'(');
  IF clone_definition=definition THEN RAISE EXCEPTION 'Authorization definition shape changed' USING ERRCODE='PT409'; END IF;
  EXECUTE clone_definition;
  EXECUTE format('ALTER FUNCTION private.%I(%s) OWNER TO %I',clone_name,pg_get_function_identity_arguments(fn.oid),pg_get_userbyid(fn.proowner));
  EXECUTE format('REVOKE ALL ON FUNCTION private.%I(%s) FROM PUBLIC,anon,authenticated,service_role',clone_name,pg_get_function_identity_arguments(fn.oid));
  SELECT string_agg(format('%I',x),',' ORDER BY pos) INTO call_args FROM unnest(fn.proargnames) WITH ORDINALITY names(x,pos);
  SELECT x INTO actor_arg FROM unnest(fn.proargnames) x WHERE x IN('_user','_user_id','p_user_id') LIMIT 1;
  SELECT x INTO tenant_arg FROM unnest(fn.proargnames) x WHERE x IN('_tenant','_tenant_id','p_tenant_id') LIMIT 1;
  gate:='private.rlnext_account_allowed(auth.uid(),NULL)';
  IF actor_arg IS NOT NULL THEN gate:=gate||format(' AND private.rlnext_account_allowed(%I,%s)',actor_arg,CASE WHEN tenant_arg IS NULL THEN 'NULL' ELSE quote_ident(tenant_arg) END); END IF;
  body:='SELECT ('||gate||') AND private.'||quote_ident(clone_name)||'('||call_args||')';
  IF fn.lanname='plpgsql' THEN body:='BEGIN RETURN ('||gate||') AND private.'||quote_ident(clone_name)||'('||call_args||'); END'; END IF;
  -- pg_get_functiondef always emits this delimiter. Reject shape drift.
  IF position('$function$' IN definition)=0 THEN RAISE EXCEPTION 'Authorization body delimiter changed' USING ERRCODE='PT409'; END IF;
  definition:=split_part(definition,'$function$',1)||'$function$'||body||'$function$'||split_part(definition,'$function$',3);
  EXECUTE definition;
  IF EXISTS(SELECT 1 FROM pg_proc WHERE oid=fn.oid AND (proowner IS DISTINCT FROM before_owner OR proacl IS DISTINCT FROM before_acl OR proconfig IS DISTINCT FROM before_config OR proargtypes IS DISTINCT FROM fn.proargtypes OR prorettype IS DISTINCT FROM fn.prorettype)) THEN RAISE EXCEPTION 'Authorization metadata changed' USING ERRCODE='PT409'; END IF;
 END LOOP;
END $$;
CREATE FUNCTION public.rlnext_actor_allowed() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND private.rlnext_account_allowed(auth.uid(),NULL)
$$;
REVOKE ALL ON FUNCTION public.rlnext_actor_allowed() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.rlnext_actor_allowed() TO authenticated;

-- END INPUT: Original permission-body overlay

-- BEGIN INPUT: MFA before approval/permissions
-- Parent-only proposal, after frozen Recovery SQL in the SAME guarded transaction.
-- No owner/legacy identity, role, session or factor is reset/backfilled.
ALTER TABLE private.rlnext_accounts ADD COLUMN mfa_required boolean NOT NULL DEFAULT false;
ALTER TABLE private.rlnext_accounts ADD COLUMN mfa_verified_at timestamptz;
ALTER TABLE private.rlnext_accounts ADD COLUMN mfa_session_id uuid;
CREATE FUNCTION private.rlnext_has_verified_mfa(_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM auth.mfa_factors WHERE user_id=_user AND status::text='verified' AND factor_type::text='totp')
$$;
CREATE FUNCTION private.rlnext_signup_requires_mfa() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN IF NEW.status='pending_verification' AND NEW.user_id IS NULL THEN NEW.mfa_required:=true; END IF; RETURN NEW; END $$;
CREATE TRIGGER rlnext_signup_requires_mfa BEFORE INSERT ON private.rlnext_accounts FOR EACH ROW EXECUTE FUNCTION private.rlnext_signup_requires_mfa();

CREATE OR REPLACE FUNCTION public.rlnext_verify_finish(_id uuid,_confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.rlnext_challenges; a private.rlnext_accounts;
BEGIN
 PERFORM private.rlnext_service();
 PERFORM pg_advisory_xact_lock(hashtextextended('rlnext:'||coalesce((SELECT tenant_id::text FROM private.rlnext_challenges WHERE id=_id),'unknown'),0));
 SELECT * INTO STRICT c FROM private.rlnext_challenges WHERE id=_id FOR UPDATE;
 SELECT * INTO STRICT a FROM private.rlnext_accounts WHERE id=c.account_id FOR UPDATE;
 IF c.purpose<>'verify' OR c.verify_state<>'claimed' THEN RETURN jsonb_build_object('held',true); END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=a.user_id AND lower(email)=a.email AND email_confirmed_at IS NOT NULL) OR NOT private.rlnext_domain(a.tenant_id,a.email) THEN RETURN jsonb_build_object('held',true); END IF;
 UPDATE private.rlnext_accounts SET verified_at=clock_timestamp(),status='pending_verification',mfa_required=true,version=version+1 WHERE id=a.id;
 UPDATE private.rlnext_challenges SET verify_state='complete' WHERE id=c.id;
 PERFORM private.rlnext_record(a.tenant_id,a.id,a.user_id,'email_verified');
 -- No approval queue notification or membership before genuine provider MFA.
 RETURN jsonb_build_object('onboarding_required',true,'onboarding_user_id',a.user_id);
END $$;

CREATE FUNCTION public.rlnext_complete_mfa(_slug text,_id uuid,_receipt_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); c private.rlnext_challenges; a private.rlnext_accounts; session_id uuid;
BEGIN
 IF actor IS NULL OR auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' OR NOT private.rlnext_has_verified_mfa(actor) THEN RAISE EXCEPTION 'Genuine provider MFA required' USING ERRCODE='42501'; END IF;
 IF coalesce(auth.jwt()->>'session_id','') !~ '^[a-f0-9-]{36}$' THEN RAISE EXCEPTION 'Current provider session required' USING ERRCODE='42501'; END IF;
 session_id:=(auth.jwt()->>'session_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=session_id AND s.user_id=actor) THEN RAISE EXCEPTION 'Current provider session required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('rlnext:'||coalesce((SELECT tenant_id::text FROM private.rlnext_challenges WHERE id=_id),'unknown'),0));
 SELECT * INTO c FROM private.rlnext_challenges WHERE id=_id AND receipt_hash=_receipt_hash AND purpose='verify' AND verify_state='complete' FOR UPDATE;
 IF c.id IS NULL THEN RAISE EXCEPTION 'Verified email receipt required' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM private.rlnext_accounts WHERE id=c.account_id AND user_id=actor FOR UPDATE;
 IF a.id IS NULL OR a.verified_at IS NULL OR NOT a.mfa_required OR NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=a.tenant_id AND slug=_slug) OR NOT private.rlnext_domain(a.tenant_id,a.email)
 OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor AND lower(email)=a.email AND email_confirmed_at IS NOT NULL)
 OR EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id=actor) OR public.is_platform_admin(actor)
 THEN RAISE EXCEPTION 'Current applicant scope required' USING ERRCODE='42501'; END IF;
 IF a.status='pending_approval' AND a.mfa_verified_at IS NOT NULL THEN RETURN jsonb_build_object('accepted',true,'idempotent',true); END IF;
 IF a.status<>'pending_verification' THEN RAISE EXCEPTION 'Applicant state changed' USING ERRCODE='PT409'; END IF;
 UPDATE private.rlnext_accounts SET status='pending_approval',mfa_verified_at=clock_timestamp(),mfa_session_id=session_id,version=version+1 WHERE id=a.id;
 PERFORM private.rlnext_record(a.tenant_id,a.id,actor,'mfa_admission_verified',NULL,jsonb_build_object('assurance','provider_aal2'));
 PERFORM private.rlnext_notice(a.id,'pending_approval',NULL,true);
 RETURN jsonb_build_object('accepted',true);
END $$;

CREATE FUNCTION private.rlnext_approval_requires_mfa() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.mfa_required AND (NEW.status IN('pending_approval','active') OR NEW.assigned) AND (NEW.mfa_verified_at IS NULL OR NOT private.rlnext_has_verified_mfa(NEW.user_id)) THEN
  RAISE EXCEPTION 'Current verified applicant MFA required before approval or permissions' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rlnext_approval_requires_mfa BEFORE UPDATE OF status,assigned ON private.rlnext_accounts FOR EACH ROW EXECUTE FUNCTION private.rlnext_approval_requires_mfa();

CREATE OR REPLACE FUNCTION private.rlnext_session_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE applicant private.rlnext_accounts;
BEGIN
 IF private.rlnext_account_allowed(NEW.user_id,NULL) THEN RETURN NEW; END IF;
 SELECT * INTO applicant FROM private.rlnext_accounts WHERE user_id=NEW.user_id;
 -- This is a normal Supabase session restricted by unchanged business/RLS
 -- gates, not an application session or permission grant.
 IF applicant.mfa_required AND applicant.status IN('pending_verification','pending_approval') AND applicant.verified_at IS NOT NULL AND private.rlnext_domain(applicant.tenant_id,applicant.email)
 AND EXISTS(SELECT 1 FROM auth.users WHERE id=NEW.user_id AND lower(email)=applicant.email AND email_confirmed_at IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id=NEW.user_id) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Account lifecycle prevents sign-in' USING ERRCODE='42501';
END $$;

CREATE OR REPLACE FUNCTION private.rlnext_account_allowed(_user uuid,_tenant uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM private.rlnext_accounts WHERE user_id=_user AND (_tenant IS NULL OR tenant_id=_tenant) AND (
 status<>'active' OR reset_required OR EXISTS(SELECT 1 FROM auth.users u WHERE u.id=_user AND u.banned_until>now())
 OR mfa_required AND (mfa_verified_at IS NULL OR NOT private.rlnext_has_verified_mfa(_user) OR _user IS NOT DISTINCT FROM auth.uid() AND auth.jwt()->>'aal' IS DISTINCT FROM 'aal2')))
$$;

-- Authenticated own-state RPC for existing Faraday invitation enrollment.
CREATE FUNCTION public.signup_mfa_admission_state() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); email text;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 IF public.is_platform_admin(actor) OR EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id=actor) THEN RETURN jsonb_build_object('state','existing_access','user_id',actor); END IF;
 SELECT lower(u.email) INTO email FROM auth.users u WHERE u.id=actor AND u.email_confirmed_at IS NOT NULL;
 IF email IS NULL OR NOT EXISTS(SELECT 1 FROM public.tenant_email_domains WHERE domain::text=split_part(email,'@',2) AND status='verified') THEN RETURN jsonb_build_object('state','email_verification_required','user_id',actor); END IF;
 RETURN jsonb_build_object('state',CASE WHEN auth.jwt()->>'aal'='aal2' AND private.rlnext_has_verified_mfa(actor) THEN 'mfa_ready' ELSE 'mfa_required' END,'user_id',actor);
END $$;
REVOKE ALL ON FUNCTION private.rlnext_has_verified_mfa(uuid),private.rlnext_signup_requires_mfa(),private.rlnext_approval_requires_mfa() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.rlnext_complete_mfa(text,uuid,text),public.signup_mfa_admission_state() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.rlnext_complete_mfa(text,uuid,text),public.signup_mfa_admission_state() TO authenticated;
-- Existing frozen RLS/permission/session/UUID authority and grants remain intact.

-- END INPUT: MFA before approval/permissions

-- BEGIN INPUT: MFA restriction-transition qualification fix
-- Qualification fix only: security-restricting status actions must still work
-- if an assigned applicant's factor was removed. Check fresh admission/grants,
-- not a pre-existing assigned flag on lock/disable/suspend.
CREATE OR REPLACE FUNCTION private.rlnext_approval_requires_mfa() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.mfa_required AND (
   NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN('pending_approval','active')
   OR NEW.assigned AND NOT OLD.assigned
 ) AND (NEW.mfa_verified_at IS NULL OR NOT private.rlnext_has_verified_mfa(NEW.user_id)) THEN
  RAISE EXCEPTION 'Current verified applicant MFA required before approval or permissions' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;

-- END INPUT: MFA restriction-transition qualification fix

-- BEGIN INPUT: MFA public status
CREATE OR REPLACE FUNCTION public.rlnext_status(_id uuid,_receipt_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.rlnext_challenges; a private.rlnext_accounts;
BEGIN
 PERFORM private.rlnext_service(); SELECT * INTO c FROM private.rlnext_challenges WHERE id=_id AND (receipt_hash=_receipt_hash OR reset_hash=_receipt_hash) AND created_at>clock_timestamp()-interval '24 hours';
 IF c.id IS NULL THEN RETURN '{}'::jsonb; END IF;
 SELECT * INTO STRICT a FROM private.rlnext_accounts WHERE id=c.account_id;
 IF a.mfa_required AND a.status='pending_verification' AND a.verified_at IS NOT NULL AND c.purpose='verify' AND c.verify_state='complete' THEN RETURN jsonb_build_object('onboarding_required',true,'onboarding_user_id',a.user_id); END IF;
 IF c.create_state='uncertain' THEN
   UPDATE private.rlnext_accounts ac SET user_id=u.id FROM auth.users u WHERE ac.id=a.id AND ac.user_id IS NULL AND lower(u.email)=ac.email AND u.email_confirmed_at IS NULL AND u.raw_user_meta_data->>'fvi_lifecycle_request'=c.id::text AND NOT EXISTS(SELECT 1 FROM public.tenant_members m WHERE m.user_id=u.id);
   IF FOUND THEN UPDATE private.rlnext_challenges SET create_state='created' WHERE id=c.id; c.create_state:='created'; END IF;
 END IF;
 IF c.verify_state='claimed' AND c.purpose='verify' THEN RETURN public.rlnext_verify_finish(c.id,false); END IF;
 IF c.reset_state IN('claimed','uncertain') THEN
   IF (public.rlnext_reset_finish(c.id,false)->>'completed')::boolean THEN RETURN jsonb_build_object('status','active','assigned',a.assigned,'completed',true); END IF;
 END IF;
 RETURN jsonb_build_object('status',a.status,'assigned',a.assigned,'reset_required',c.reset_state IN('ready','claimed','uncertain'),'reset_expires',floor(extract(epoch FROM c.reset_expires_at)*1000)::bigint,'held',c.create_state='uncertain' OR c.send_state IN('claimed','uncertain') OR c.verify_state='claimed' OR c.reset_state IN('claimed','uncertain'));
END $$;

-- END INPUT: MFA public status

-- BEGIN INPUT: Legacy MFA order
-- Parent only: fingerprint the exact TWO current legacy definitions/authority
-- with legacy-mfa-catalog-capture.sql. No old SQL migration is replayed.
DO $guard$
DECLARE actual text; expected text:=current_setting('fvi.legacy_mfa_helper_fingerprint',true); fn record; definition text; body text; insertion text;
BEGIN
 SELECT md5(jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,'owner',p.proowner::text,'acl',p.proacl::text,'config',p.proconfig,'arguments',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'definition',md5(pg_get_functiondef(p.oid))) ORDER BY p.oid)::text) INTO actual
 FROM pg_proc p WHERE p.oid IN('public.request_tenant_admission()'::regprocedure,'public.decide_tenant_admission(uuid,uuid,text)'::regprocedure);
 IF expected IS NULL OR expected !~ '^[a-f0-9]{32}$' OR actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Legacy MFA metadata requires current reviewed fingerprint' USING ERRCODE='PT409'; END IF;
 FOR fn IN SELECT p.* FROM pg_proc p WHERE p.oid IN('public.request_tenant_admission()'::regprocedure,'public.decide_tenant_admission(uuid,uuid,text)'::regprocedure) ORDER BY p.oid LOOP
  definition:=pg_get_functiondef(fn.oid);body:=fn.prosrc;
  IF position('BEGIN' IN body)=0 OR position('$function$' IN definition)=0 OR position('private.rlnext_has_verified_mfa' IN body)>0 THEN RAISE EXCEPTION 'Legacy MFA body shape changed' USING ERRCODE='PT409'; END IF;
  IF fn.proname='request_tenant_admission' THEN
   insertion:='BEGIN
 IF auth.uid() IS NOT NULL AND NOT public.is_platform_admin(auth.uid()) AND NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id=auth.uid()) AND (auth.jwt()->>''aal'' IS DISTINCT FROM ''aal2'' OR NOT private.rlnext_has_verified_mfa(auth.uid())) THEN RAISE EXCEPTION ''Verify Supabase MFA before requesting approval'' USING ERRCODE=''42501''; END IF;';
  ELSE
   insertion:='BEGIN
 IF auth.uid() IS NULL OR auth.jwt()->>''aal'' IS DISTINCT FROM ''aal2'' THEN RAISE EXCEPTION ''Genuine current administrator MFA required'' USING ERRCODE=''42501''; END IF;
 IF _decision=''approved'' AND EXISTS(SELECT 1 FROM public.tenant_signup_requests r WHERE r.id=_request_id AND r.tenant_id=_tenant_id AND r.status=''pending'' AND NOT private.rlnext_has_verified_mfa(r.user_id)) THEN RAISE EXCEPTION ''Current applicant MFA required before permissions'' USING ERRCODE=''42501''; END IF;';
  END IF;
  body:=overlay(body placing insertion from position('BEGIN' IN body) for length('BEGIN'));
  definition:=split_part(definition,'$function$',1)||'$function$'||body||'$function$'||split_part(definition,'$function$',3);
  EXECUTE definition;
  IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=fn.oid AND (p.proowner IS DISTINCT FROM fn.proowner OR p.proacl IS DISTINCT FROM fn.proacl OR p.proconfig IS DISTINCT FROM fn.proconfig OR p.proargtypes IS DISTINCT FROM fn.proargtypes OR p.prorettype IS DISTINCT FROM fn.prorettype)) THEN RAISE EXCEPTION 'Legacy identity/authority contract changed' USING ERRCODE='PT409'; END IF;
 END LOOP;
END $guard$;

-- END INPUT: Legacy MFA order

-- BEGIN INPUT: Verified producer bridge
-- Parent pairs with the existing reviewed Nash notification migration/bindings.
-- A private verified attempt supplies user/outcome; callers cannot override them.
CREATE FUNCTION public.rlnext_capture_login_event(_attempt uuid,_binding text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE recorded record;
BEGIN
 PERFORM private.rlnext_service();
 SELECT request_id,user_id,outcome INTO recorded FROM private.failed_login_attempts
 WHERE id=_attempt AND binding=_binding AND finished_at IS NOT NULL AND stage IN('password','mfa');
 IF NOT FOUND OR recorded.user_id IS NULL THEN RETURN false; END IF;
 RETURN private.rlnext_verified_login_event(recorded.request_id,recorded.user_id,recorded.outcome);
END $$;
REVOKE ALL ON FUNCTION public.rlnext_capture_login_event(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rlnext_capture_login_event(uuid,text) TO service_role;

-- END INPUT: Verified producer bridge

-- BEGIN INPUT: Access active-admin lifecycle coupling
-- Narrow successor coupling: Access source remains exact in a restricted clone.
-- Run after the unchanged lifecycle/MFA fragments. No Access policy/RPC rewrite.
DO $access_overlay$
DECLARE fn pg_proc; definition text; clone_definition text; wrapper text; original_contract jsonb;
BEGIN
 SELECT * INTO STRICT fn FROM pg_proc WHERE oid='private.fvi_active_structure_admin(uuid,uuid)'::regprocedure;
 IF fn.proargnames IS DISTINCT FROM ARRAY['_tenant','_actor']::text[] OR fn.proargmodes IS NOT NULL
 OR fn.proargtypes IS DISTINCT FROM '2950 2950'::oidvector OR fn.prorettype<>'boolean'::regtype
 OR NOT fn.prosecdef OR fn.proretset OR fn.provariadic<>0 OR fn.provolatile<>'s'
 OR fn.prolang<>(SELECT oid FROM pg_language WHERE lanname='sql') THEN
   RAISE EXCEPTION 'Unsupported exact Access admin helper mapping/ABI' USING ERRCODE='PT409';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='private' AND p.proname='rlnext_base_private_fvi_active_structure_admin') THEN
   RAISE EXCEPTION 'Access lifecycle clone collision' USING ERRCODE='PT409';
 END IF;
 original_contract:=to_jsonb(fn)-'prosrc'-'probin';
 definition:=pg_get_functiondef(fn.oid);
 clone_definition:=replace(definition,'FUNCTION private.fvi_active_structure_admin(',
   'FUNCTION private.rlnext_base_private_fvi_active_structure_admin(');
 IF clone_definition=definition OR position('$function$' IN definition)=0
 OR cardinality(string_to_array(definition,'$function$'))<>3 THEN
   RAISE EXCEPTION 'Exact Access definition shape changed' USING ERRCODE='PT409';
 END IF;
 EXECUTE clone_definition;
 EXECUTE format('ALTER FUNCTION private.rlnext_base_private_fvi_active_structure_admin(uuid,uuid) OWNER TO %I',pg_get_userbyid(fn.proowner));
 REVOKE ALL ON FUNCTION private.rlnext_base_private_fvi_active_structure_admin(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
 -- _actor and _tenant are explicitly mapped only for this exact Access helper.
 wrapper:='SELECT private.rlnext_account_allowed(auth.uid(),NULL) AND private.rlnext_account_allowed(_actor,_tenant) AND private.rlnext_base_private_fvi_active_structure_admin(_tenant,_actor)';
 EXECUTE split_part(definition,'$function$',1)||'$function$'||wrapper||'$function$'||split_part(definition,'$function$',3);
 IF (SELECT to_jsonb(p)-'prosrc'-'probin' FROM pg_proc p WHERE p.oid=fn.oid) IS DISTINCT FROM original_contract
 OR (SELECT prosrc FROM pg_proc WHERE oid='private.rlnext_base_private_fvi_active_structure_admin(uuid,uuid)'::regprocedure) IS DISTINCT FROM fn.prosrc
 OR (SELECT prosrc FROM pg_proc WHERE oid=fn.oid) IS DISTINCT FROM wrapper THEN
   RAISE EXCEPTION 'Access original source/ABI/ACL/config preservation failed' USING ERRCODE='PT409';
 END IF;
END $access_overlay$;

-- END INPUT: Access active-admin lifecycle coupling

-- BEGIN INPUT: Full direct admin lifecycle/MFA enforcement
-- SEC-RECOVERY-ADMIN-LIFECYCLE: exact native actor lifecycle denial.
DO $direct_admin_fix$ DECLARE fn pg_proc; definition text; contract jsonb; BEGIN
 SELECT * INTO STRICT fn FROM pg_proc WHERE oid='private.rlnext_admin_current(uuid)'::regprocedure;
 IF fn.prosrc IS DISTINCT FROM '
DECLARE actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR auth.jwt()->>''aal'' IS DISTINCT FROM ''aal2'' OR NOT EXISTS(
   SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=actor AND active AND role::text=''tenant_admin''
 ) OR EXISTS(SELECT 1 FROM private.rlnext_accounts WHERE user_id=actor AND (status<>''active'' OR reset_required OR EXISTS(SELECT 1 FROM auth.users u WHERE u.id=actor AND u.banned_until>now())))
 THEN RAISE EXCEPTION ''Current tenant administrator with MFA required'' USING ERRCODE=''42501''; END IF;
 -- Prevent revocation racing a decision: hold current membership through this transaction.
 PERFORM 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=actor AND active AND role::text=''tenant_admin'' FOR SHARE;
 RETURN actor;
END ' THEN RAISE EXCEPTION 'Direct admin exact source preimage changed' USING ERRCODE='PT409'; END IF;
 contract:=to_jsonb(fn)-'prosrc'-'probin'; definition:=pg_get_functiondef(fn.oid);
 IF cardinality(string_to_array(definition,'$function$'))<>3 THEN RAISE EXCEPTION 'Direct admin source delimiter changed' USING ERRCODE='PT409'; END IF;
 EXECUTE split_part(definition,'$function$',1)||'$function$'||'
DECLARE actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR auth.jwt()->>''aal'' IS DISTINCT FROM ''aal2'' OR NOT private.rlnext_account_allowed(actor,NULL) OR NOT EXISTS(
   SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=actor AND active AND role::text=''tenant_admin''
 ) OR EXISTS(SELECT 1 FROM private.rlnext_accounts WHERE user_id=actor AND (status<>''active'' OR reset_required OR EXISTS(SELECT 1 FROM auth.users u WHERE u.id=actor AND u.banned_until>now())))
 THEN RAISE EXCEPTION ''Current tenant administrator with MFA required'' USING ERRCODE=''42501''; END IF;
 -- Prevent revocation racing a decision: hold current membership through this transaction.
 PERFORM 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=actor AND active AND role::text=''tenant_admin'' FOR SHARE;
 RETURN actor;
END '||'$function$'||split_part(definition,'$function$',3);
 IF (SELECT to_jsonb(p)-'prosrc'-'probin' FROM pg_proc p WHERE oid=fn.oid) IS DISTINCT FROM contract
 OR (SELECT prosrc FROM pg_proc WHERE oid=fn.oid) IS DISTINCT FROM '
DECLARE actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR auth.jwt()->>''aal'' IS DISTINCT FROM ''aal2'' OR NOT private.rlnext_account_allowed(actor,NULL) OR NOT EXISTS(
   SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=actor AND active AND role::text=''tenant_admin''
 ) OR EXISTS(SELECT 1 FROM private.rlnext_accounts WHERE user_id=actor AND (status<>''active'' OR reset_required OR EXISTS(SELECT 1 FROM auth.users u WHERE u.id=actor AND u.banned_until>now())))
 THEN RAISE EXCEPTION ''Current tenant administrator with MFA required'' USING ERRCODE=''42501''; END IF;
 -- Prevent revocation racing a decision: hold current membership through this transaction.
 PERFORM 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=actor AND active AND role::text=''tenant_admin'' FOR SHARE;
 RETURN actor;
END ' THEN RAISE EXCEPTION 'Direct admin OID/ABI/owner/ACL/config/source changed' USING ERRCODE='PT409'; END IF;
 END $direct_admin_fix$;
DO $direct_admin_fix$ DECLARE fn pg_proc; definition text; contract jsonb; BEGIN
 SELECT * INTO STRICT fn FROM pg_proc WHERE oid='public.decide_tenant_admission(uuid,uuid,text)'::regprocedure;
 IF fn.prosrc IS DISTINCT FROM '
DECLARE v_actor uuid := auth.uid(); v_request public.tenant_signup_requests; v_auth_email text;
BEGIN
 IF auth.uid() IS NULL OR auth.jwt()->>''aal'' IS DISTINCT FROM ''aal2'' THEN RAISE EXCEPTION ''Genuine current administrator MFA required'' USING ERRCODE=''42501''; END IF;
 IF _decision=''approved'' AND EXISTS(SELECT 1 FROM public.tenant_signup_requests r WHERE r.id=_request_id AND r.tenant_id=_tenant_id AND r.status=''pending'' AND NOT private.rlnext_has_verified_mfa(r.user_id)) THEN RAISE EXCEPTION ''Current applicant MFA required before permissions'' USING ERRCODE=''42501''; END IF;
  IF _decision NOT IN (''approved'',''denied'') THEN RAISE EXCEPTION ''Invalid decision'' USING ERRCODE=''22023''; END IF;
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tenant_members m WHERE m.tenant_id=_tenant_id
      AND m.user_id=v_actor AND m.active AND m.role=''tenant_admin''::public.tenant_role
  ) THEN RAISE EXCEPTION ''Not authorized'' USING ERRCODE=''42501''; END IF;
  SELECT * INTO v_request FROM public.tenant_signup_requests r
    WHERE r.id=_request_id AND r.tenant_id=_tenant_id AND r.status=''pending'' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION ''Request unavailable'' USING ERRCODE=''22023''; END IF;
  IF v_request.user_id=v_actor THEN RAISE EXCEPTION ''Not authorized'' USING ERRCODE=''42501''; END IF;
  SELECT lower(u.email) INTO v_auth_email FROM auth.users u
    WHERE u.id=v_request.user_id AND u.confirmed_at IS NOT NULL;
  IF v_auth_email IS NULL OR v_auth_email<>lower(v_request.email::text)
     OR NOT EXISTS (SELECT 1 FROM public.tenant_email_domains d
                    WHERE d.tenant_id=_tenant_id AND d.domain=split_part(v_auth_email,''@'',2)
                      AND d.status=''verified'') THEN
    RAISE EXCEPTION ''Request unavailable'' USING ERRCODE=''22023'';
  END IF;
  IF _decision=''approved'' THEN
    IF EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.user_id=v_request.user_id AND m.tenant_id<>_tenant_id) THEN
      RAISE EXCEPTION ''Request unavailable'' USING ERRCODE=''22023'';
    END IF;
    INSERT INTO public.tenant_members(tenant_id,user_id,role,invited_by)
    VALUES (_tenant_id,v_request.user_id,''tenant_viewer''::public.tenant_role,v_actor)
    ON CONFLICT (tenant_id,user_id) DO NOTHING;
    IF NOT EXISTS (SELECT 1 FROM public.tenant_members m
                   WHERE m.tenant_id=_tenant_id AND m.user_id=v_request.user_id
                     AND m.active=true AND m.role=''tenant_viewer''::public.tenant_role) THEN
      RAISE EXCEPTION ''Request unavailable'' USING ERRCODE=''22023'';
    END IF;
  END IF;
  UPDATE public.tenant_signup_requests SET status=_decision,decided_at=now(),decided_by=v_actor
    WHERE id=_request_id RETURNING * INTO v_request;
  INSERT INTO public.tenant_signup_events(request_id,tenant_id,user_id,event_name)
  VALUES (_request_id,_tenant_id,v_request.user_id,''signup.admission_''||_decision);
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (v_actor,_tenant_id,''tenant'',''signup.admission_''||_decision,''tenant_signup_request'',_request_id::text,
          jsonb_build_object(''user_id'',v_request.user_id));
  RETURN v_request;
END ' THEN RAISE EXCEPTION 'Direct admin exact source preimage changed' USING ERRCODE='PT409'; END IF;
 contract:=to_jsonb(fn)-'prosrc'-'probin'; definition:=pg_get_functiondef(fn.oid);
 IF cardinality(string_to_array(definition,'$function$'))<>3 THEN RAISE EXCEPTION 'Direct admin source delimiter changed' USING ERRCODE='PT409'; END IF;
 EXECUTE split_part(definition,'$function$',1)||'$function$'||'
DECLARE v_actor uuid := auth.uid(); v_request public.tenant_signup_requests; v_auth_email text;
BEGIN
 PERFORM private.rlnext_admin_current(_tenant_id);
 IF auth.uid() IS NULL OR auth.jwt()->>''aal'' IS DISTINCT FROM ''aal2'' THEN RAISE EXCEPTION ''Genuine current administrator MFA required'' USING ERRCODE=''42501''; END IF;
 IF _decision=''approved'' AND EXISTS(SELECT 1 FROM public.tenant_signup_requests r WHERE r.id=_request_id AND r.tenant_id=_tenant_id AND r.status=''pending'' AND NOT private.rlnext_has_verified_mfa(r.user_id)) THEN RAISE EXCEPTION ''Current applicant MFA required before permissions'' USING ERRCODE=''42501''; END IF;
  IF _decision NOT IN (''approved'',''denied'') THEN RAISE EXCEPTION ''Invalid decision'' USING ERRCODE=''22023''; END IF;
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tenant_members m WHERE m.tenant_id=_tenant_id
      AND m.user_id=v_actor AND m.active AND m.role=''tenant_admin''::public.tenant_role
  ) THEN RAISE EXCEPTION ''Not authorized'' USING ERRCODE=''42501''; END IF;
  SELECT * INTO v_request FROM public.tenant_signup_requests r
    WHERE r.id=_request_id AND r.tenant_id=_tenant_id AND r.status=''pending'' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION ''Request unavailable'' USING ERRCODE=''22023''; END IF;
  IF v_request.user_id=v_actor THEN RAISE EXCEPTION ''Not authorized'' USING ERRCODE=''42501''; END IF;
  SELECT lower(u.email) INTO v_auth_email FROM auth.users u
    WHERE u.id=v_request.user_id AND u.confirmed_at IS NOT NULL;
  IF v_auth_email IS NULL OR v_auth_email<>lower(v_request.email::text)
     OR NOT EXISTS (SELECT 1 FROM public.tenant_email_domains d
                    WHERE d.tenant_id=_tenant_id AND d.domain=split_part(v_auth_email,''@'',2)
                      AND d.status=''verified'') THEN
    RAISE EXCEPTION ''Request unavailable'' USING ERRCODE=''22023'';
  END IF;
  IF _decision=''approved'' THEN
    IF EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.user_id=v_request.user_id AND m.tenant_id<>_tenant_id) THEN
      RAISE EXCEPTION ''Request unavailable'' USING ERRCODE=''22023'';
    END IF;
    INSERT INTO public.tenant_members(tenant_id,user_id,role,invited_by)
    VALUES (_tenant_id,v_request.user_id,''tenant_viewer''::public.tenant_role,v_actor)
    ON CONFLICT (tenant_id,user_id) DO NOTHING;
    IF NOT EXISTS (SELECT 1 FROM public.tenant_members m
                   WHERE m.tenant_id=_tenant_id AND m.user_id=v_request.user_id
                     AND m.active=true AND m.role=''tenant_viewer''::public.tenant_role) THEN
      RAISE EXCEPTION ''Request unavailable'' USING ERRCODE=''22023'';
    END IF;
  END IF;
  UPDATE public.tenant_signup_requests SET status=_decision,decided_at=now(),decided_by=v_actor
    WHERE id=_request_id RETURNING * INTO v_request;
  INSERT INTO public.tenant_signup_events(request_id,tenant_id,user_id,event_name)
  VALUES (_request_id,_tenant_id,v_request.user_id,''signup.admission_''||_decision);
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (v_actor,_tenant_id,''tenant'',''signup.admission_''||_decision,''tenant_signup_request'',_request_id::text,
          jsonb_build_object(''user_id'',v_request.user_id));
  RETURN v_request;
END '||'$function$'||split_part(definition,'$function$',3);
 IF (SELECT to_jsonb(p)-'prosrc'-'probin' FROM pg_proc p WHERE oid=fn.oid) IS DISTINCT FROM contract
 OR (SELECT prosrc FROM pg_proc WHERE oid=fn.oid) IS DISTINCT FROM '
DECLARE v_actor uuid := auth.uid(); v_request public.tenant_signup_requests; v_auth_email text;
BEGIN
 PERFORM private.rlnext_admin_current(_tenant_id);
 IF auth.uid() IS NULL OR auth.jwt()->>''aal'' IS DISTINCT FROM ''aal2'' THEN RAISE EXCEPTION ''Genuine current administrator MFA required'' USING ERRCODE=''42501''; END IF;
 IF _decision=''approved'' AND EXISTS(SELECT 1 FROM public.tenant_signup_requests r WHERE r.id=_request_id AND r.tenant_id=_tenant_id AND r.status=''pending'' AND NOT private.rlnext_has_verified_mfa(r.user_id)) THEN RAISE EXCEPTION ''Current applicant MFA required before permissions'' USING ERRCODE=''42501''; END IF;
  IF _decision NOT IN (''approved'',''denied'') THEN RAISE EXCEPTION ''Invalid decision'' USING ERRCODE=''22023''; END IF;
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tenant_members m WHERE m.tenant_id=_tenant_id
      AND m.user_id=v_actor AND m.active AND m.role=''tenant_admin''::public.tenant_role
  ) THEN RAISE EXCEPTION ''Not authorized'' USING ERRCODE=''42501''; END IF;
  SELECT * INTO v_request FROM public.tenant_signup_requests r
    WHERE r.id=_request_id AND r.tenant_id=_tenant_id AND r.status=''pending'' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION ''Request unavailable'' USING ERRCODE=''22023''; END IF;
  IF v_request.user_id=v_actor THEN RAISE EXCEPTION ''Not authorized'' USING ERRCODE=''42501''; END IF;
  SELECT lower(u.email) INTO v_auth_email FROM auth.users u
    WHERE u.id=v_request.user_id AND u.confirmed_at IS NOT NULL;
  IF v_auth_email IS NULL OR v_auth_email<>lower(v_request.email::text)
     OR NOT EXISTS (SELECT 1 FROM public.tenant_email_domains d
                    WHERE d.tenant_id=_tenant_id AND d.domain=split_part(v_auth_email,''@'',2)
                      AND d.status=''verified'') THEN
    RAISE EXCEPTION ''Request unavailable'' USING ERRCODE=''22023'';
  END IF;
  IF _decision=''approved'' THEN
    IF EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.user_id=v_request.user_id AND m.tenant_id<>_tenant_id) THEN
      RAISE EXCEPTION ''Request unavailable'' USING ERRCODE=''22023'';
    END IF;
    INSERT INTO public.tenant_members(tenant_id,user_id,role,invited_by)
    VALUES (_tenant_id,v_request.user_id,''tenant_viewer''::public.tenant_role,v_actor)
    ON CONFLICT (tenant_id,user_id) DO NOTHING;
    IF NOT EXISTS (SELECT 1 FROM public.tenant_members m
                   WHERE m.tenant_id=_tenant_id AND m.user_id=v_request.user_id
                     AND m.active=true AND m.role=''tenant_viewer''::public.tenant_role) THEN
      RAISE EXCEPTION ''Request unavailable'' USING ERRCODE=''22023'';
    END IF;
  END IF;
  UPDATE public.tenant_signup_requests SET status=_decision,decided_at=now(),decided_by=v_actor
    WHERE id=_request_id RETURNING * INTO v_request;
  INSERT INTO public.tenant_signup_events(request_id,tenant_id,user_id,event_name)
  VALUES (_request_id,_tenant_id,v_request.user_id,''signup.admission_''||_decision);
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (v_actor,_tenant_id,''tenant'',''signup.admission_''||_decision,''tenant_signup_request'',_request_id::text,
          jsonb_build_object(''user_id'',v_request.user_id));
  RETURN v_request;
END ' THEN RAISE EXCEPTION 'Direct admin OID/ABI/owner/ACL/config/source changed' USING ERRCODE='PT409'; END IF;
 END $direct_admin_fix$;

-- END INPUT: Full direct admin lifecycle/MFA enforcement
