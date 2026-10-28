-- Bind every cross-environment package to one immutable tenant family and a
-- separately derived canonical legal-identity hash. User email domains never
-- determine tenant identity.

ALTER TABLE public.tenant_families
  ADD COLUMN IF NOT EXISTS release_identity_uid uuid,
  ADD COLUMN IF NOT EXISTS canonical_legal_name text,
  ADD COLUMN IF NOT EXISTS legal_entity_identifier text,
  ADD COLUMN IF NOT EXISTS verified_organization_domain text;

UPDATE public.tenant_families
SET release_identity_uid=coalesce(release_identity_uid,id),
    canonical_legal_name=coalesce(nullif(trim(canonical_legal_name),''),name)
WHERE release_identity_uid IS NULL OR canonical_legal_name IS NULL OR trim(canonical_legal_name)='';

UPDATE public.tenant_families
SET verified_organization_domain='recon-spark.example'
WHERE name='Recon Spark Assurance Group' AND verified_organization_domain IS NULL;

ALTER TABLE public.tenant_families
  ALTER COLUMN release_identity_uid SET NOT NULL,
  ALTER COLUMN canonical_legal_name SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tenant_families_release_identity_uid_uq
  ON public.tenant_families(release_identity_uid);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_families_verified_organization_domain_uq
  ON public.tenant_families(lower(verified_organization_domain))
  WHERE verified_organization_domain IS NOT NULL;

ALTER TABLE public.tenant_families
  DROP CONSTRAINT IF EXISTS tenant_families_legal_entity_identifier_check;
ALTER TABLE public.tenant_families
  ADD CONSTRAINT tenant_families_legal_entity_identifier_check CHECK (
    legal_entity_identifier IS NULL
    OR legal_entity_identifier ~ '^[A-Z0-9][A-Z0-9._-]{3,39}$'
  );

ALTER TABLE public.tenant_families
  DROP CONSTRAINT IF EXISTS tenant_families_verified_organization_domain_check;
ALTER TABLE public.tenant_families
  ADD CONSTRAINT tenant_families_verified_organization_domain_check CHECK (
    verified_organization_domain IS NULL
    OR (
      verified_organization_domain=lower(verified_organization_domain)
      AND verified_organization_domain ~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$'
      AND position('.' in verified_organization_domain)>1
      AND position('..' in verified_organization_domain)=0
    )
  );

CREATE OR REPLACE FUNCTION public.environment_tenant_identity(_tenant_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $$
  SELECT jsonb_build_object(
    'release_identity_uid',f.release_identity_uid,
    'canonical_legal_name',f.canonical_legal_name,
    'legal_entity_identifier',f.legal_entity_identifier,
    'verified_organization_domain',f.verified_organization_domain,
    'legal_identity_hash',encode(extensions.digest(convert_to(
      lower(regexp_replace(trim(f.canonical_legal_name),'[[:space:]]+',' ','g'))||'|'||
      coalesce(upper(trim(f.legal_entity_identifier)),'')
    ,'UTF8'),'sha256'),'hex'),
    'domain_identity_hash',CASE WHEN f.verified_organization_domain IS NULL THEN NULL ELSE
      encode(extensions.digest(convert_to(lower(trim(f.verified_organization_domain)),'UTF8'),'sha256'),'hex') END
  )
  FROM public.tenants t JOIN public.tenant_families f ON f.id=t.family_id
  WHERE t.id=_tenant_id
$$;

CREATE OR REPLACE FUNCTION public.guard_environment_tenant_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path=public
AS $$
DECLARE expected jsonb := NEW.manifest->'settings'->'tenant_identity'; actual jsonb;
BEGIN
  IF expected IS NULL OR jsonb_typeof(expected)<>'object' THEN
    RAISE EXCEPTION 'Environment package requires tenant identity proof';
  END IF;
  actual := public.environment_tenant_identity(NEW.control_tenant_id);
  IF actual IS NULL
     OR expected->>'release_identity_uid' IS DISTINCT FROM actual->>'release_identity_uid'
     OR expected->>'legal_identity_hash' IS DISTINCT FROM actual->>'legal_identity_hash'
     OR expected->>'verified_organization_domain' IS NULL
     OR expected->>'verified_organization_domain' IS DISTINCT FROM actual->>'verified_organization_domain'
     OR expected->>'domain_identity_hash' IS DISTINCT FROM actual->>'domain_identity_hash' THEN
    RAISE EXCEPTION 'Source and target tenants are not the same registered organization';
  END IF;
  IF NEW.approval_stage='source_review' AND NEW.source_tenant_id<>NEW.control_tenant_id THEN
    RAISE EXCEPTION 'Source review must be controlled by the source tenant';
  END IF;
  IF NEW.approval_stage='target_review' AND NEW.target_tenant_id<>NEW.control_tenant_id THEN
    RAISE EXCEPTION 'Target review must be controlled by the target tenant';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_environment_tenant_identity ON public.environment_change_requests;
CREATE TRIGGER guard_environment_tenant_identity
BEFORE INSERT ON public.environment_change_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_environment_tenant_identity();

-- The original receiver remains an owner-only implementation detail. The
-- public service-role entry point validates organization identity before the
-- receiver can take either its insert or idempotent-replay path.
ALTER FUNCTION public.receive_environment_change_for_api(jsonb,text)
  RENAME TO receive_environment_change_unbound_for_api;

CREATE OR REPLACE FUNCTION public.receive_environment_change_for_api(
  _request jsonb,
  _requester_email text
) RETURNS TABLE(request_id uuid,change_request_uid text,request_status text,manifest_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  target_tenant uuid := nullif(_request->>'target_tenant_id','')::uuid;
  expected jsonb := _request->'manifest'->'settings'->'tenant_identity';
  actual jsonb;
BEGIN
  IF target_tenant IS NULL OR expected IS NULL OR jsonb_typeof(expected)<>'object' THEN
    RAISE EXCEPTION 'Environment package requires target tenant identity proof';
  END IF;
  actual := public.environment_tenant_identity(target_tenant);
  IF actual IS NULL
     OR expected->>'release_identity_uid' IS DISTINCT FROM actual->>'release_identity_uid'
     OR expected->>'legal_identity_hash' IS DISTINCT FROM actual->>'legal_identity_hash'
     OR expected->>'verified_organization_domain' IS NULL
     OR expected->>'verified_organization_domain' IS DISTINCT FROM actual->>'verified_organization_domain'
     OR expected->>'domain_identity_hash' IS DISTINCT FROM actual->>'domain_identity_hash' THEN
    RAISE EXCEPTION 'Source and target tenants are not the same registered organization';
  END IF;
  RETURN QUERY SELECT * FROM public.receive_environment_change_unbound_for_api(
    _request,_requester_email
  );
END;
$$;

REVOKE ALL ON FUNCTION public.receive_environment_change_unbound_for_api(jsonb,text)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.receive_environment_change_for_api(jsonb,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.receive_environment_change_for_api(jsonb,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.record_environment_package_rejection_for_api(
  _target_tenant_id uuid,
  _actor_user_id uuid,
  _incident jsonb
) RETURNS TABLE(security_event_id bigint,incident_id uuid,audit_id bigint,emails_queued integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  event_id bigint;
  rule_uid uuid;
  alert_uid uuid;
  audit_uid bigint;
  recipient record;
  queued integer := 0;
BEGIN
  PERFORM public.assert_environment_change_actor(_target_tenant_id,_actor_user_id);
  PERFORM public.assert_environment_payload_safe(coalesce(_incident,'{}'::jsonb));
  IF coalesce(_incident->>'reason_code','')<>'environment_package_tenant_mismatch'
     OR coalesce((_incident->>'package_rejected')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Invalid environment package rejection incident';
  END IF;

  INSERT INTO public.security_events(tenant_id,user_id,event_type,severity,context)
  VALUES (_target_tenant_id,_actor_user_id,'environment_package_tenant_mismatch','critical',_incident)
  RETURNING id INTO event_id;

  INSERT INTO public.security_alert_rules(
    tenant_id,code,description,event_type_pattern,min_severity,window_minutes,
    threshold,cooldown_minutes,severity,notify_channels,enabled,created_by,updated_by
  ) VALUES (
    _target_tenant_id,'ENVIRONMENT_PACKAGE_TENANT_MISMATCH',
    'Reject and escalate a signed environment package addressed to another tenant.',
    'environment_package_tenant_mismatch','critical',60,1,1,'critical',
    '["in_app","email"]'::jsonb,true,_actor_user_id,_actor_user_id
  ) ON CONFLICT (coalesce(tenant_id,'00000000-0000-0000-0000-000000000000'::uuid),code)
    DO UPDATE SET enabled=true,updated_at=now(),updated_by=excluded.updated_by
  RETURNING id INTO rule_uid;

  INSERT INTO public.security_alert_incidents(
    rule_id,tenant_id,event_count,window_minutes,severity,sample_event_ids,context
  ) VALUES (
    rule_uid,_target_tenant_id,1,60,'critical',ARRAY[event_id],
    _incident||jsonb_build_object('rule_code','ENVIRONMENT_PACKAGE_TENANT_MISMATCH')
  ) RETURNING id INTO alert_uid;

  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (
    _actor_user_id,_target_tenant_id,'security','environment_change.cross_tenant_import_rejected',
    'environment_package',coalesce(_incident->>'source_request_uid','unknown'),
    _incident||jsonb_build_object('security_event_id',event_id,'incident_id',alert_uid)
  ) RETURNING id INTO audit_uid;

  FOR recipient IN
    SELECT DISTINCT candidates.email FROM (
      SELECT p.email
      FROM public.profiles p
      WHERE p.id=_actor_user_id AND p.email IS NOT NULL
      UNION
      SELECT p.email
      FROM public.tenant_members tm JOIN public.profiles p ON p.id=tm.user_id
      WHERE tm.tenant_id=_target_tenant_id AND tm.active
        AND tm.role='tenant_admin' AND p.email IS NOT NULL
    ) candidates
  LOOP
    PERFORM public.enqueue_email('transactional_emails',jsonb_build_object(
      'to',recipient.email,
      'subject','[FVI Security] Cross-tenant package import rejected',
      'template','environment_package_tenant_mismatch',
      'data',jsonb_build_object(
        'body','A signed package for another tenant or environment was rejected before installation.',
        'incident_id',alert_uid,
        'security_event_id',event_id,
        'source_request_uid',_incident->>'source_request_uid'
      )
    ));
    queued := queued+1;
  END LOOP;

  RETURN QUERY SELECT event_id,alert_uid,audit_uid,queued;
END;
$$;

REVOKE ALL ON FUNCTION public.environment_tenant_identity(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.environment_tenant_identity(uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.record_environment_package_rejection_for_api(uuid,uuid,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_environment_package_rejection_for_api(uuid,uuid,jsonb)
  TO service_role;

COMMENT ON COLUMN public.tenant_families.release_identity_uid IS
  'Immutable organization identity shared by its DEV, UAT and PROD tenants.';
COMMENT ON COLUMN public.tenant_families.canonical_legal_name IS
  'Canonical organization name used for the independent legal-identity hash.';
COMMENT ON COLUMN public.tenant_families.legal_entity_identifier IS
  'Optional LEI or equivalent organization identifier; never inferred from a user email domain.';
COMMENT ON COLUMN public.tenant_families.verified_organization_domain IS
  'Platform-verified organization domain shared across environments; never inferred from a user email.';
COMMENT ON FUNCTION public.record_environment_package_rejection_for_api(uuid,uuid,jsonb) IS
  'Service-only rejection evidence: critical event, incident, immutable audit row and tenant-admin email queue.';
