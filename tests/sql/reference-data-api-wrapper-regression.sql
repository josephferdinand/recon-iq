\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE api_versions(
  version_id uuid,
  version_number integer,
  row_count integer,
  content_sha256 text
);
GRANT SELECT, INSERT ON api_versions TO service_role;

INSERT INTO auth.users(id,email,created_at,updated_at)
VALUES
  ('b1111111-1111-4111-8111-111111111111','reference-api-maker@invalid.test',now(),now()),
  ('b2222222-2222-4222-8222-222222222222','reference-api-checker@invalid.test',now(),now()),
  ('b5555555-5555-4555-8555-555555555555','reference-api-outsider@invalid.test',now(),now());
INSERT INTO public.tenants(id,slug,name,created_by)
VALUES
  ('b3333333-3333-4333-8333-333333333333','reference-api','Reference API','b1111111-1111-4111-8111-111111111111'),
  ('b6666666-6666-4666-8666-666666666666','reference-api-outsider','Reference API Outsider','b5555555-5555-4555-8555-555555555555');
INSERT INTO public.tenant_members(tenant_id,user_id,role)
VALUES
  ('b3333333-3333-4333-8333-333333333333','b1111111-1111-4111-8111-111111111111','tenant_admin'),
  ('b3333333-3333-4333-8333-333333333333','b2222222-2222-4222-8222-222222222222','tenant_admin'),
  ('b6666666-6666-4666-8666-666666666666','b5555555-5555-4555-8555-555555555555','tenant_admin');
INSERT INTO public.reference_data_tables(id,tenant_id,name,key_columns,value_columns,created_by)
VALUES (
  'b4444444-4444-4444-8444-444444444444',
  'b3333333-3333-4333-8333-333333333333',
  'API aliases',ARRAY['alias'],ARRAY['canonical'],
  'b1111111-1111-4111-8111-111111111111'
);

SET LOCAL ROLE service_role;
INSERT INTO api_versions
SELECT * FROM public.stage_reference_data_version_for_api(
  'b3333333-3333-4333-8333-333333333333',
  'b4444444-4444-4444-8444-444444444444',
  '[{"alias":"US DOLLAR","canonical":"USD"},{"alias":"USD","canonical":"USD"}]',
  current_date,NULL,'API staged controlled aliases',
  'b1111111-1111-4111-8111-111111111111'
);
SELECT public.submit_reference_data_version_for_api(
  'b3333333-3333-4333-8333-333333333333',
  (SELECT version_id FROM api_versions),
  'b1111111-1111-4111-8111-111111111111'
);

DO $$
BEGIN
  BEGIN
    PERFORM public.decide_reference_data_version_for_api(
      'b3333333-3333-4333-8333-333333333333',
      (SELECT version_id FROM api_versions),true,'Self approval attempt',
      'b1111111-1111-4111-8111-111111111111'
    );
    RAISE EXCEPTION 'API maker self approval unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM * FROM public.stage_reference_data_version_for_api(
      'b3333333-3333-4333-8333-333333333333',
      'b4444444-4444-4444-8444-444444444444',
      '[{"alias":"EUR","canonical":"EUR"}]',current_date,NULL,
      'Cross tenant actor attempt','b5555555-5555-4555-8555-555555555555'
    );
    RAISE EXCEPTION 'foreign API actor unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

SELECT public.decide_reference_data_version_for_api(
  'b3333333-3333-4333-8333-333333333333',
  (SELECT version_id FROM api_versions),true,'Independent API approval',
  'b2222222-2222-4222-8222-222222222222'
);

DO $$
BEGIN
  IF (SELECT status FROM public.reference_data_versions WHERE id=(SELECT version_id FROM api_versions)) <> 'published' THEN
    RAISE EXCEPTION 'API wrapper publication failed';
  END IF;
  IF (SELECT row_count FROM public.reference_data_tables WHERE id='b4444444-4444-4444-8444-444444444444') <> 2 THEN
    RAISE EXCEPTION 'API wrapper projection failed';
  END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE tenant_id='b3333333-3333-4333-8333-333333333333' AND action LIKE 'reference_data.version.%') <> 3 THEN
    RAISE EXCEPTION 'API wrapper lifecycle audit mismatch';
  END IF;
END $$;
RESET ROLE;

DO $$
BEGIN
  IF has_function_privilege(
    'authenticated',
    'public.stage_reference_data_version_for_api(uuid,uuid,jsonb,date,date,text,uuid)',
    'EXECUTE'
  ) THEN RAISE EXCEPTION 'authenticated API stage wrapper privilege leaked'; END IF;
  IF has_function_privilege(
    'authenticated',
    'public.decide_reference_data_version_for_api(uuid,uuid,boolean,text,uuid)',
    'EXECUTE'
  ) THEN RAISE EXCEPTION 'authenticated API decision wrapper privilege leaked'; END IF;
END $$;

SELECT 'reference_data_api_wrapper_PASS actor=yes tenant=yes four_eyes=yes projection=yes audit=3 privileges=yes';
ROLLBACK;
