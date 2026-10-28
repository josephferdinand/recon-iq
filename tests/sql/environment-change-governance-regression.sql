\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE ec_ids(label text PRIMARY KEY,id uuid);
GRANT SELECT,INSERT ON ec_ids TO service_role,authenticated;

INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('e1111111-1111-4111-8111-111111111111','ec-maker@invalid.test',now(),now()),
  ('e2222222-2222-4222-8222-222222222222','ec-checker@invalid.test',now(),now()),
  ('e3333333-3333-4333-8333-333333333333','ec-outsider@invalid.test',now(),now());
INSERT INTO public.tenants(id,slug,name,created_by) VALUES
  ('e4444444-4444-4444-8444-444444444444','ec-control','Environment Control','e1111111-1111-4111-8111-111111111111'),
  ('e5555555-5555-4555-8555-555555555555','ec-foreign','Environment Foreign','e3333333-3333-4333-8333-333333333333');
INSERT INTO public.tenant_members(tenant_id,user_id,role) VALUES
  ('e4444444-4444-4444-8444-444444444444','e1111111-1111-4111-8111-111111111111','tenant_admin'),
  ('e4444444-4444-4444-8444-444444444444','e2222222-2222-4222-8222-222222222222','tenant_admin'),
  ('e5555555-5555-4555-8555-555555555555','e3333333-3333-4333-8333-333333333333','tenant_admin');

SET LOCAL ROLE service_role;

DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.request_environment_change_for_api(jsonb_build_object(
      'control_tenant_id','e4444444-4444-4444-8444-444444444444',
      'direction','prod_to_dev','source_project_ref','YOUR_PROJECT_REF',
      'source_tenant_id','e4444444-4444-4444-8444-444444444444',
      'target_project_ref','YOUR_PROJECT_REF','target_tenant_id','e6666666-6666-4666-8666-666666666666',
      'title','Unsafe manifest','reason','Regression must reject embedded credentials',
      'manifest',jsonb_build_object('package','{}'::jsonb,'configuration','{}'::jsonb,
        'settings',jsonb_build_object('access_token','sbp_'||repeat('1',30))),
      'idempotency_key','ec-unsafe-0001'
    ),'e1111111-1111-4111-8111-111111111111');
    RAISE EXCEPTION 'credential-shaped manifest unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='credential-shaped manifest unexpectedly accepted' THEN RAISE; END IF;
  END;
END $$;

INSERT INTO ec_ids
SELECT 'success',request_id FROM public.request_environment_change_for_api(jsonb_build_object(
  'control_tenant_id','e4444444-4444-4444-8444-444444444444',
  'direction','prod_to_dev','source_project_ref','YOUR_PROJECT_REF',
  'source_tenant_id','e4444444-4444-4444-8444-444444444444',
  'target_project_ref','YOUR_PROJECT_REF','target_tenant_id','e6666666-6666-4666-8666-666666666666',
  'title','Seed DEV assurance tenant','reason','Create governed DEV configuration from approved PROD baseline',
  'manifest',jsonb_build_object(
    'package',jsonb_build_object('reconciliations',16,'data_prep',16),
    'configuration',jsonb_build_object('connectors',7,'watchers',14),
    'settings',jsonb_build_object('theme','navy-gold','surface','porcelain')),
  'idempotency_key','ec-success-0001'
),'e1111111-1111-4111-8111-111111111111');

DO $$ DECLARE original uuid; replay uuid; BEGIN
  SELECT id INTO original FROM ec_ids WHERE label='success';
  SELECT request_id INTO replay FROM public.request_environment_change_for_api(jsonb_build_object(
    'control_tenant_id','e4444444-4444-4444-8444-444444444444',
    'direction','prod_to_dev','source_project_ref','YOUR_PROJECT_REF',
    'source_tenant_id','e4444444-4444-4444-8444-444444444444',
    'target_project_ref','YOUR_PROJECT_REF','target_tenant_id','e6666666-6666-4666-8666-666666666666',
    'title','Seed DEV assurance tenant','reason','Create governed DEV configuration from approved PROD baseline',
    'manifest',jsonb_build_object(
      'package',jsonb_build_object('reconciliations',16,'data_prep',16),
      'configuration',jsonb_build_object('connectors',7,'watchers',14),
      'settings',jsonb_build_object('theme','navy-gold','surface','porcelain')),
    'idempotency_key','ec-success-0001'
  ),'e1111111-1111-4111-8111-111111111111');
  IF replay IS DISTINCT FROM original THEN RAISE EXCEPTION 'idempotent replay changed request'; END IF;
END $$;

SELECT public.record_environment_change_preflight_for_api(
  (SELECT id FROM ec_ids WHERE label='success'),
  '[{"check":"source_export","status":"pass"},{"check":"target_compatibility","status":"pass"},{"check":"secret_scan","status":"pass"}]',
  'e1111111-1111-4111-8111-111111111111'
);

DO $$ BEGIN
  BEGIN
    PERFORM public.decide_environment_change_as((SELECT id FROM ec_ids WHERE label='success'),true,'self approval',
      'e1111111-1111-4111-8111-111111111111');
    RAISE EXCEPTION 'requester self approval unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='requester self approval unexpectedly accepted' THEN RAISE; END IF;
  END;
END $$;

SELECT public.decide_environment_change_as((SELECT id FROM ec_ids WHERE label='success'),true,'Independent checker approved',
  'e2222222-2222-4222-8222-222222222222');

DO $$ BEGIN
  BEGIN
    PERFORM public.start_environment_change_execution_for_api((SELECT id FROM ec_ids WHERE label='success'),
      'exec-success-0001','e2222222-2222-4222-8222-222222222222');
    RAISE EXCEPTION 'checker execution unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='checker execution unexpectedly accepted' THEN RAISE; END IF;
  END;
END $$;

SELECT public.start_environment_change_execution_for_api((SELECT id FROM ec_ids WHERE label='success'),
  'exec-success-0001','e1111111-1111-4111-8111-111111111111');
SELECT public.complete_environment_change_execution_for_api((SELECT id FROM ec_ids WHERE label='success'),
  'succeeded','[{"component":"package","status":"pass"},{"component":"configuration","status":"pass"},{"component":"settings","status":"pass"}]',
  '{"target_project_ref":"YOUR_PROJECT_REF","readback":"exact"}',NULL,
  'e1111111-1111-4111-8111-111111111111');

INSERT INTO ec_ids
SELECT 'rejected',request_id FROM public.request_environment_change_for_api(jsonb_build_object(
  'control_tenant_id','e4444444-4444-4444-8444-444444444444',
  'direction','dev_to_prod','source_project_ref','YOUR_PROJECT_REF',
  'source_tenant_id','e6666666-6666-4666-8666-666666666666',
  'target_project_ref','YOUR_PROJECT_REF','target_tenant_id','e4444444-4444-4444-8444-444444444444',
  'title','Reject drifted DEV delta','reason','Retain rejected change request as audit evidence',
  'manifest',jsonb_build_object('package','{}'::jsonb,'configuration','{}'::jsonb,'settings','{}'::jsonb),
  'idempotency_key','ec-rejected-0001'
),'e1111111-1111-4111-8111-111111111111');
SELECT public.record_environment_change_preflight_for_api((SELECT id FROM ec_ids WHERE label='rejected'),
  '[{"check":"source_export","status":"fail"}]','e1111111-1111-4111-8111-111111111111');
SELECT public.decide_environment_change_as((SELECT id FROM ec_ids WHERE label='rejected'),false,'Source validation failed',
  'e2222222-2222-4222-8222-222222222222');

DO $$ BEGIN
  BEGIN
    UPDATE public.environment_change_requests SET title='bypass' WHERE id=(SELECT id FROM ec_ids WHERE label='success');
    RAISE EXCEPTION 'direct lifecycle update unexpectedly accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM='direct lifecycle update unexpectedly accepted' THEN RAISE; END IF;
  END;
END $$;

DO $$
DECLARE bad_chain integer;
BEGIN
  IF (SELECT status FROM public.environment_change_requests WHERE id=(SELECT id FROM ec_ids WHERE label='success'))<>'succeeded' THEN
    RAISE EXCEPTION 'successful request did not reach succeeded';
  END IF;
  IF (SELECT decided_by=requested_by FROM public.environment_change_requests WHERE id=(SELECT id FROM ec_ids WHERE label='success')) THEN
    RAISE EXCEPTION 'maker/checker separation missing';
  END IF;
  IF (SELECT count(*) FROM public.environment_change_events WHERE request_id=(SELECT id FROM ec_ids WHERE label='success'))<>5 THEN
    RAISE EXCEPTION 'successful audit history incomplete';
  END IF;
  SELECT count(*) INTO bad_chain FROM (
    SELECT prev_hash,lag(row_hash) OVER (ORDER BY event_sequence) expected
    FROM public.environment_change_events WHERE request_id=(SELECT id FROM ec_ids WHERE label='success')
  ) q WHERE prev_hash IS DISTINCT FROM expected;
  IF bad_chain<>0 THEN RAISE EXCEPTION 'environment audit hash chain invalid'; END IF;
  IF (SELECT status FROM public.environment_change_requests WHERE id=(SELECT id FROM ec_ids WHERE label='rejected'))<>'rejected' THEN
    RAISE EXCEPTION 'rejected request was not retained';
  END IF;
END $$;

SELECT 'environment_change_governance_PASS directions=yes manifests=hashed secrets=denied idempotency=yes four_eyes=yes preflight=yes execution=yes rejected=retained audit=hash_linked bypass=denied';
ROLLBACK;
