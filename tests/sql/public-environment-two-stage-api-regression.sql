\set ON_ERROR_STOP on
BEGIN;

-- Disposable public API fixture: keep the real cutover gate open only inside
-- this rollback-only transaction so these synthetic requests exercise the API.
SELECT public.set_environment_change_cutover_pause(false,'Disposable public API regression setup');

INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('c1111111-1111-4111-8111-111111111111','public-source-maker@invalid.test',now(),now()),
  ('c2222222-2222-4222-8222-222222222222','public-source-checker@invalid.test',now(),now()),
  ('c3333333-3333-4333-8333-333333333333','public-target-importer@invalid.test',now(),now()),
  ('c4444444-4444-4444-8444-444444444444','public-target-checker@invalid.test',now(),now());
INSERT INTO public.tenant_families(
  id,name,release_identity_uid,canonical_legal_name,verified_organization_domain
) VALUES ('c0000000-0000-4000-8000-000000000001','Public Package Fixture',
  'c0000000-0000-4000-8000-000000000001','Public Package Fixture','public-package.invalid.test');
INSERT INTO public.tenants(id,slug,name,environment,created_by,family_id) VALUES
  ('c5555555-5555-4555-8555-555555555555','public-package-source','Public Package Source','dev',
    'c1111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000001'),
  ('c6666666-6666-4666-8666-666666666666','public-package-target','Public Package Target','prod',
    'c3333333-3333-4333-8333-333333333333','c0000000-0000-4000-8000-000000000001');
INSERT INTO public.tenant_members(tenant_id,user_id,role) VALUES
  ('c5555555-5555-4555-8555-555555555555','c1111111-1111-4111-8111-111111111111','tenant_admin'),
  ('c5555555-5555-4555-8555-555555555555','c2222222-2222-4222-8222-222222222222','tenant_admin'),
  ('c6666666-6666-4666-8666-666666666666','c3333333-3333-4333-8333-333333333333','tenant_admin'),
  ('c6666666-6666-4666-8666-666666666666','c4444444-4444-4444-8444-444444444444','tenant_admin');

CREATE TEMP TABLE public_api_fixture AS
SELECT jsonb_build_object(
  'control_tenant_id','c5555555-5555-4555-8555-555555555555',
  'direction','dev_to_prod','source_environment','dev','target_environment','prod',
  'source_project_ref','YOUR_PROJECT_REF','target_project_ref','YOUR_PROJECT_REF',
  'source_tenant_id','c5555555-5555-4555-8555-555555555555',
  'target_tenant_id','c6666666-6666-4666-8666-666666666666',
  'title','Public two-stage fixture','reason','Independent source and target reviewers approve.',
  'manifest',jsonb_build_object('package','{}'::jsonb,'configuration','{}'::jsonb,
    'settings',jsonb_build_object('tenant_identity',
      public.environment_tenant_identity('c5555555-5555-4555-8555-555555555555'))),
  'validation_results','[{"check":"source_binding","status":"pass"}]'::jsonb,
  'idempotency_key','public-two-stage-001'
) AS payload;

DO $$
BEGIN
  IF NOT has_function_privilege('service_role',
    'public.request_source_environment_change_for_api(jsonb,uuid)','EXECUTE') OR
     NOT has_function_privilege('service_role',
    'public.decide_source_environment_change_for_api(uuid,boolean,text,uuid)','EXECUTE') OR
     NOT has_function_privilege('service_role',
    'public.approve_incoming_environment_change_for_api(uuid,boolean,text,boolean,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Required service-role public two-stage grant is missing';
  END IF;
  IF has_function_privilege('service_role',
       'public.request_environment_change_for_api(jsonb,uuid)','EXECUTE') OR
     has_function_privilege('service_role',
       'public.decide_environment_change_for_api(uuid,boolean,text,uuid)','EXECUTE') OR
     has_function_privilege('authenticated',
       'public.request_environment_change(jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Legacy environment-change bypass remains callable';
  END IF;
  BEGIN
    PERFORM * FROM public.request_source_environment_change_for_api(
      (SELECT payload||jsonb_build_object('control_tenant_id',
        'c6666666-6666-4666-8666-666666666666') FROM public_api_fixture),
      'c1111111-1111-4111-8111-111111111111');
    RAISE EXCEPTION 'Wrong control tenant unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Wrong control tenant unexpectedly accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%Source tenant must match%' THEN RAISE; END IF;
  END;
END $$;

CREATE TEMP TABLE public_api_source AS
SELECT request_id FROM public.request_source_environment_change_for_api(
  (SELECT payload FROM public_api_fixture),'c1111111-1111-4111-8111-111111111111');
DO $$
BEGIN
  BEGIN
    PERFORM public.decide_source_environment_change_for_api(
      (SELECT request_id FROM public_api_source),true,'Self approval',
      'c1111111-1111-4111-8111-111111111111');
    RAISE EXCEPTION 'Source self approval unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Source self approval unexpectedly accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%Four-eyes%' THEN RAISE; END IF;
  END;
END $$;
SELECT public.decide_source_environment_change_for_api(
  (SELECT request_id FROM public_api_source),true,'Independent source approval',
  'c2222222-2222-4222-8222-222222222222');

CREATE TEMP TABLE public_api_target AS
SELECT request_id FROM public.receive_environment_change_for_api(
  (SELECT jsonb_build_object(
    'source_project_ref',r.source_project_ref,'source_tenant_id',r.source_tenant_id,
    'source_environment',r.source_environment,'target_project_ref',r.target_project_ref,
    'target_tenant_id',r.target_tenant_id,'target_environment',r.target_environment,
    'direction',r.direction,'title',r.title,'reason',r.reason,'manifest',r.manifest,
    'upstream_change_request_uid',r.change_request_uid,
    'upstream_manifest_hash',r.manifest_hash,'source_request_status',r.status,
    'source_requester_email','public-source-maker@invalid.test',
    'source_requester_email_hash',encode(extensions.digest(
      convert_to('public-source-maker@invalid.test','UTF8'),'sha256'),'hex'),
    'source_approver_email_hash',encode(extensions.digest(
      convert_to('public-source-checker@invalid.test','UTF8'),'sha256'),'hex'),
    'validation_results','[{"check":"target_binding","status":"pass"}]'::jsonb)
   FROM public.environment_change_requests r WHERE r.id=(SELECT request_id FROM public_api_source)),
  'public-source-maker@invalid.test','c3333333-3333-4333-8333-333333333333');

DO $$
BEGIN
  BEGIN
    PERFORM public.decide_source_environment_change_for_api(
      (SELECT request_id FROM public_api_target),true,'Wrong review stage',
      'c4444444-4444-4444-8444-444444444444');
    RAISE EXCEPTION 'Target row accepted source decision';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Target row accepted source decision' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%Source review is required%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.approve_incoming_environment_change_for_api(
      (SELECT request_id FROM public_api_target),true,'Self approval',true,
      'c3333333-3333-4333-8333-333333333333');
    RAISE EXCEPTION 'Target importer self approval unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Target importer self approval unexpectedly accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%Four-eyes%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.approve_incoming_environment_change_for_api(
      (SELECT request_id FROM public_api_target),true,'Mapping not confirmed',false,
      'c4444444-4444-4444-8444-444444444444');
    RAISE EXCEPTION 'Missing mapping confirmation unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Missing mapping confirmation unexpectedly accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%confirm user/group mappings%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.approve_incoming_environment_change_for_api(
      (SELECT request_id FROM public_api_target),true,'Wrong tenant checker',true,
      'c2222222-2222-4222-8222-222222222222');
    RAISE EXCEPTION 'Foreign tenant checker unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Foreign tenant checker unexpectedly accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%requires platform or tenant administrator%' THEN RAISE; END IF;
  END;
END $$;

-- A historical target row without importer binding must be rejected by the
-- public wrapper even when the checker and mapping confirmation are valid.
SELECT set_config('app.environment_change_lifecycle','on',true);
UPDATE public.environment_change_requests SET source_requester_email_hash=NULL
WHERE id=(SELECT request_id FROM public_api_target);
SELECT set_config('app.environment_change_lifecycle','',true);
DO $$
BEGIN
  BEGIN
    PERFORM public.approve_incoming_environment_change_for_api(
      (SELECT request_id FROM public_api_target),true,'Unbound target',true,
      'c4444444-4444-4444-8444-444444444444');
    RAISE EXCEPTION 'Unbound target unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Unbound target unexpectedly accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%Bound incoming target review is required%' THEN RAISE; END IF;
  END;
END $$;
SELECT set_config('app.environment_change_lifecycle','on',true);
UPDATE public.environment_change_requests SET source_requester_email_hash=
  encode(extensions.digest(convert_to('public-source-maker@invalid.test','UTF8'),'sha256'),'hex')
WHERE id=(SELECT request_id FROM public_api_target);
SELECT set_config('app.environment_change_lifecycle','',true);
SELECT public.approve_incoming_environment_change_for_api(
  (SELECT request_id FROM public_api_target),true,'Mapping confirmed',true,
  'c4444444-4444-4444-8444-444444444444');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.environment_change_requests
    WHERE id=(SELECT request_id FROM public_api_source)
      AND approval_stage='source_review' AND status='approved') OR
     NOT EXISTS (SELECT 1 FROM public.environment_change_requests
    WHERE id=(SELECT request_id FROM public_api_target)
      AND approval_stage='target_review' AND status='approved'
      AND access_mapping_confirmed_by='c4444444-4444-4444-8444-444444444444') THEN
    RAISE EXCEPTION 'Public two-stage approval result mismatch';
  END IF;
END $$;
SELECT 'public_environment_two_stage_api_PASS';
ROLLBACK;
