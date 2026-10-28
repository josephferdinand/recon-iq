\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE dp_ids(label text PRIMARY KEY,id uuid);
GRANT SELECT,INSERT ON dp_ids TO service_role,authenticated;

INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('d1111111-1111-4111-8111-111111111111','dp-maker@invalid.test',now(),now()),
  ('d2222222-2222-4222-8222-222222222222','dp-checker@invalid.test',now(),now()),
  ('d3333333-3333-4333-8333-333333333333','dp-outsider@invalid.test',now(),now());
INSERT INTO public.tenants(id,slug,name,created_by) VALUES
  ('d4444444-4444-4444-8444-444444444444','dp-governed','DP Governed','d1111111-1111-4111-8111-111111111111'),
  ('d5555555-5555-4555-8555-555555555555','dp-foreign','DP Foreign','d3333333-3333-4333-8333-333333333333');
INSERT INTO public.tenant_members(tenant_id,user_id,role) VALUES
  ('d4444444-4444-4444-8444-444444444444','d1111111-1111-4111-8111-111111111111','tenant_admin'),
  ('d4444444-4444-4444-8444-444444444444','d2222222-2222-4222-8222-222222222222','tenant_admin'),
  ('d5555555-5555-4555-8555-555555555555','d3333333-3333-4333-8333-333333333333','tenant_admin');
INSERT INTO public.data_prep_pipelines(
  id,tenant_id,name,steps,dq_rules,on_failure,enabled,status,lifecycle_state,created_by
) VALUES (
  'd6666666-6666-4666-8666-666666666666','d4444444-4444-4444-8444-444444444444',
  'Governed production pipeline','[]','[]','block',true,'draft','production',
  'd1111111-1111-4111-8111-111111111111'
);

SET LOCAL ROLE service_role;
INSERT INTO dp_ids
SELECT 'api-created',pipeline_id FROM public.upsert_data_prep_pipeline_for_api(
  'd4444444-4444-4444-8444-444444444444',NULL,
  '{"name":"API governed pipeline","description":"Created for lifecycle regression","steps":[],"dq_rules":[],"on_failure":"warn","enabled":true}',
  'd1111111-1111-4111-8111-111111111111'
);
SELECT * FROM public.upsert_data_prep_pipeline_for_api(
  'd4444444-4444-4444-8444-444444444444',(SELECT id FROM dp_ids WHERE label='api-created'),
  '{"description":"Updated through actor-bound API wrapper"}',
  'd1111111-1111-4111-8111-111111111111'
);
SELECT public.archive_data_prep_pipeline_for_api(
  'd4444444-4444-4444-8444-444444444444',(SELECT id FROM dp_ids WHERE label='api-created'),
  'Regression evidence retention','d2222222-2222-4222-8222-222222222222'
);
DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.approve_data_prep_pipeline_for_api(
      'd4444444-4444-4444-8444-444444444444','d6666666-6666-4666-8666-666666666666',
      'd1111111-1111-4111-8111-111111111111');
    RAISE EXCEPTION 'maker self approval unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'maker self approval unexpectedly accepted' THEN RAISE; END IF;
  END;
END $$;
SELECT * FROM public.approve_data_prep_pipeline_for_api(
  'd4444444-4444-4444-8444-444444444444','d6666666-6666-4666-8666-666666666666',
  'd2222222-2222-4222-8222-222222222222');
INSERT INTO dp_ids SELECT 'staging',staging_pipeline_id FROM public.clone_data_prep_staging_for_api(
  'd4444444-4444-4444-8444-444444444444','d6666666-6666-4666-8666-666666666666',
  'd1111111-1111-4111-8111-111111111111');
SELECT * FROM public.approve_data_prep_pipeline_for_api(
  'd4444444-4444-4444-8444-444444444444',(SELECT id FROM dp_ids WHERE label='staging'),
  'd2222222-2222-4222-8222-222222222222');
SELECT public.request_data_prep_promotion_for_api(
  'd4444444-4444-4444-8444-444444444444',(SELECT id FROM dp_ids WHERE label='staging'),
  'Controlled staging promotion','d1111111-1111-4111-8111-111111111111');

DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.decide_data_prep_promotion_for_api(
      'd4444444-4444-4444-8444-444444444444',(SELECT id FROM dp_ids WHERE label='staging'),
      true,'Self decision','d1111111-1111-4111-8111-111111111111');
    RAISE EXCEPTION 'requester self decision unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'requester self decision unexpectedly accepted' THEN RAISE; END IF;
  END;
END $$;
SELECT * FROM public.decide_data_prep_promotion_for_api(
  'd4444444-4444-4444-8444-444444444444',(SELECT id FROM dp_ids WHERE label='staging'),
  true,'Independent promotion approval','d2222222-2222-4222-8222-222222222222');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d1111111-1111-4111-8111-111111111111',true);
DO $$ BEGIN
  BEGIN
    UPDATE public.data_prep_pipelines SET promotion_status='pending'
    WHERE id='d6666666-6666-4666-8666-666666666666';
    RAISE EXCEPTION 'direct lifecycle bypass unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'direct lifecycle bypass unexpectedly accepted' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.clone_data_prep_staging_for_api(
      'd4444444-4444-4444-8444-444444444444','d6666666-6666-4666-8666-666666666666',
      'd3333333-3333-4333-8333-333333333333');
    RAISE EXCEPTION 'foreign actor unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'foreign actor unexpectedly accepted' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

DO $$ BEGIN
  IF (SELECT status FROM public.data_prep_pipelines WHERE id='d6666666-6666-4666-8666-666666666666') <> 'approved' THEN
    RAISE EXCEPTION 'production status mismatch';
  END IF;
  IF (SELECT version FROM public.data_prep_pipelines WHERE id='d6666666-6666-4666-8666-666666666666') <> 2 THEN
    RAISE EXCEPTION 'production version mismatch';
  END IF;
  IF (SELECT lifecycle_state FROM public.data_prep_pipelines WHERE id=(SELECT id FROM dp_ids WHERE label='staging')) <> 'archived' THEN
    RAISE EXCEPTION 'staging archive mismatch';
  END IF;
  IF (SELECT count(*) FROM public.dp_promotion_approvals WHERE staging_pipeline_id=(SELECT id FROM dp_ids WHERE label='staging')) <> 1 THEN
    RAISE EXCEPTION 'promotion approval evidence mismatch';
  END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE tenant_id='d4444444-4444-4444-8444-444444444444'
      AND action IN ('data_prep.create','data_prep.update','data_prep.archive','data_prep.approve','data_prep.clone_as_staging','data_prep.request_promotion','data_prep.promote')) <> 8 THEN
    RAISE EXCEPTION 'lifecycle audit count mismatch';
  END IF;
  IF (SELECT lifecycle_state FROM public.data_prep_pipelines WHERE id=(SELECT id FROM dp_ids WHERE label='api-created')) <> 'archived' THEN
    RAISE EXCEPTION 'API archival mismatch';
  END IF;
  IF has_function_privilege('authenticated','public.approve_data_prep_pipeline_for_api(uuid,uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'API wrapper privilege leak';
  END IF;
END $$;

SELECT 'data_prep_governed_lifecycle_PASS crud=yes archive=yes maker_checker=yes staging=yes promotion=yes atomic=yes bypass=denied tenant=yes audit=8';
ROLLBACK;
