\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE lifecycle_versions(
  label text PRIMARY KEY,
  version_id uuid,
  version_number integer,
  row_count integer,
  content_sha256 text
);
GRANT SELECT, INSERT ON lifecycle_versions TO authenticated;
GRANT SELECT ON lifecycle_versions TO service_role;

INSERT INTO auth.users(id,email,created_at,updated_at)
VALUES
  ('a1111111-1111-4111-8111-111111111111','reference-maker@invalid.test',now(),now()),
  ('a2222222-2222-4222-8222-222222222222','reference-checker@invalid.test',now(),now()),
  ('a5555555-5555-4555-8555-555555555555','reference-outsider@invalid.test',now(),now());
INSERT INTO public.tenants(id,slug,name,created_by)
VALUES
  ('a3333333-3333-4333-8333-333333333333','reference-lifecycle','Reference Lifecycle','a1111111-1111-4111-8111-111111111111'),
  ('a6666666-6666-4666-8666-666666666666','reference-outsider','Reference Outsider','a5555555-5555-4555-8555-555555555555');
INSERT INTO public.tenant_members(tenant_id,user_id,role)
VALUES
  ('a3333333-3333-4333-8333-333333333333','a1111111-1111-4111-8111-111111111111','tenant_admin'),
  ('a3333333-3333-4333-8333-333333333333','a2222222-2222-4222-8222-222222222222','tenant_admin'),
  ('a6666666-6666-4666-8666-666666666666','a5555555-5555-4555-8555-555555555555','tenant_admin');
INSERT INTO public.reference_data_tables(id,tenant_id,name,key_columns,value_columns,created_by)
VALUES (
  'a4444444-4444-4444-8444-444444444444',
  'a3333333-3333-4333-8333-333333333333',
  'Governed currencies', ARRAY['alias'], ARRAY['canonical'],
  'a1111111-1111-4111-8111-111111111111'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
INSERT INTO lifecycle_versions
SELECT 'v1', staged.* FROM public.stage_reference_data_version(
  'a3333333-3333-4333-8333-333333333333',
  'a4444444-4444-4444-8444-444444444444',
  '[{"alias":"US DOLLAR","canonical":"USD"},{"alias":"USD","canonical":"USD"}]',
  current_date - 30, NULL, 'Initial controlled currency aliases'
) staged;
SELECT public.submit_reference_data_version(
  'a3333333-3333-4333-8333-333333333333',
  (SELECT version_id FROM lifecycle_versions WHERE label='v1')
);

DO $$
BEGIN
  BEGIN
    PERFORM public.decide_reference_data_version(
      'a3333333-3333-4333-8333-333333333333',
      (SELECT version_id FROM lifecycle_versions WHERE label='v1'),
      true, 'Maker self approval'
    );
    RAISE EXCEPTION 'maker self approval unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

SELECT set_config('request.jwt.claim.sub','a2222222-2222-4222-8222-222222222222',true);
SELECT public.decide_reference_data_version(
  'a3333333-3333-4333-8333-333333333333',
  (SELECT version_id FROM lifecycle_versions WHERE label='v1'),
  true, 'Reviewed against approved currency catalogue'
);

DO $$
DECLARE resolved record;
BEGIN
  IF (SELECT row_count FROM public.reference_data_tables WHERE id='a4444444-4444-4444-8444-444444444444') <> 2 THEN
    RAISE EXCEPTION 'published projection count mismatch';
  END IF;
  IF (SELECT published_version_id FROM public.reference_data_tables WHERE id='a4444444-4444-4444-8444-444444444444')
      <> (SELECT version_id FROM lifecycle_versions WHERE label='v1') THEN
    RAISE EXCEPTION 'published projection version mismatch';
  END IF;
  IF (SELECT count(*) FROM public.reference_data_rows WHERE table_id='a4444444-4444-4444-8444-444444444444') <> 2 THEN
    RAISE EXCEPTION 'published projection rows mismatch';
  END IF;
  SELECT * INTO resolved FROM public.resolve_reference_data_version(
    'a3333333-3333-4333-8333-333333333333','a4444444-4444-4444-8444-444444444444',current_date
  );
  IF resolved.resolved_version_id <> (SELECT version_id FROM lifecycle_versions WHERE label='v1')
     OR jsonb_array_length(resolved.resolved_rows) <> 2 THEN
    RAISE EXCEPTION 'current effective resolver mismatch';
  END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
INSERT INTO lifecycle_versions
SELECT 'v2', staged.* FROM public.stage_reference_data_version(
  'a3333333-3333-4333-8333-333333333333',
  'a4444444-4444-4444-8444-444444444444',
  '[{"alias":"US DOLLAR","canonical":"USD"},{"alias":"USD","canonical":"USD"},{"alias":"EURO","canonical":"EUR"}]',
  current_date + 10, NULL, 'Future dated euro alias addition'
) staged;
SELECT public.submit_reference_data_version(
  'a3333333-3333-4333-8333-333333333333',
  (SELECT version_id FROM lifecycle_versions WHERE label='v2')
);
SELECT set_config('request.jwt.claim.sub','a2222222-2222-4222-8222-222222222222',true);
SELECT public.decide_reference_data_version(
  'a3333333-3333-4333-8333-333333333333',
  (SELECT version_id FROM lifecycle_versions WHERE label='v2'),
  true, 'Future catalogue reviewed'
);

DO $$
DECLARE current_resolved record; future_resolved record;
BEGIN
  SELECT * INTO current_resolved FROM public.resolve_reference_data_version(
    'a3333333-3333-4333-8333-333333333333','a4444444-4444-4444-8444-444444444444',current_date
  );
  SELECT * INTO future_resolved FROM public.resolve_reference_data_version(
    'a3333333-3333-4333-8333-333333333333','a4444444-4444-4444-8444-444444444444',current_date + 10
  );
  IF current_resolved.resolved_version_id <> (SELECT version_id FROM lifecycle_versions WHERE label='v1') THEN
    RAISE EXCEPTION 'future publication changed current resolution';
  END IF;
  IF future_resolved.resolved_version_id <> (SELECT version_id FROM lifecycle_versions WHERE label='v2')
     OR jsonb_array_length(future_resolved.resolved_rows) <> 3 THEN
    RAISE EXCEPTION 'future effective resolver mismatch';
  END IF;
  IF (SELECT published_version_id FROM public.reference_data_tables WHERE id='a4444444-4444-4444-8444-444444444444')
      <> (SELECT version_id FROM lifecycle_versions WHERE label='v1') THEN
    RAISE EXCEPTION 'future approval prematurely replaced current projection';
  END IF;
END $$;

INSERT INTO lifecycle_versions
SELECT 'rollback', rolled.* FROM public.request_reference_data_rollback(
  'a3333333-3333-4333-8333-333333333333',
  'a4444444-4444-4444-8444-444444444444',
  (SELECT version_id FROM lifecycle_versions WHERE label='v1'),
  current_date + 20, 'Restore prior aliases after controlled review'
) rolled;

SELECT set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
INSERT INTO lifecycle_versions
SELECT 'rejected', staged.* FROM public.stage_reference_data_version(
  'a3333333-3333-4333-8333-333333333333',
  'a4444444-4444-4444-8444-444444444444',
  '[{"alias":"BAD","canonical":"BAD"}]',
  current_date + 30, NULL, 'Candidate requiring rejection evidence'
) staged;
SELECT public.submit_reference_data_version(
  'a3333333-3333-4333-8333-333333333333',
  (SELECT version_id FROM lifecycle_versions WHERE label='rejected')
);
SELECT set_config('request.jwt.claim.sub','a2222222-2222-4222-8222-222222222222',true);
SELECT public.decide_reference_data_version(
  'a3333333-3333-4333-8333-333333333333',
  (SELECT version_id FROM lifecycle_versions WHERE label='rejected'),
  false, 'Unapproved currency alias'
);

DO $$
BEGIN
  IF (SELECT status FROM public.reference_data_versions WHERE id=(SELECT version_id FROM lifecycle_versions WHERE label='rollback')) <> 'draft' THEN
    RAISE EXCEPTION 'rollback was not created as a new draft';
  END IF;
  IF (SELECT content_sha256 FROM lifecycle_versions WHERE label='rollback')
      <> (SELECT content_sha256 FROM lifecycle_versions WHERE label='v1') THEN
    RAISE EXCEPTION 'rollback snapshot content changed';
  END IF;
  IF (SELECT status FROM public.reference_data_versions WHERE id=(SELECT version_id FROM lifecycle_versions WHERE label='rejected')) <> 'rejected' THEN
    RAISE EXCEPTION 'rejection evidence missing';
  END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE tenant_id='a3333333-3333-4333-8333-333333333333' AND action LIKE 'reference_data.version.%') <> 11 THEN
    RAISE EXCEPTION 'lifecycle audit count mismatch';
  END IF;
  BEGIN
    UPDATE public.reference_data_tables
    SET key_columns = ARRAY['changed_key']
    WHERE id='a4444444-4444-4444-8444-444444444444';
    RAISE EXCEPTION 'versioned table key mutation unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'versioned table key mutation unexpectedly accepted' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.reference_data_tables
    WHERE id='a4444444-4444-4444-8444-444444444444';
    RAISE EXCEPTION 'versioned table deletion unexpectedly accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;

SELECT set_config('request.jwt.claim.sub','a5555555-5555-4555-8555-555555555555',true);
DO $$
BEGIN
  BEGIN
    PERFORM * FROM public.resolve_reference_data_version(
      'a3333333-3333-4333-8333-333333333333','a4444444-4444-4444-8444-444444444444',current_date
    );
    RAISE EXCEPTION 'foreign resolver unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF has_function_privilege(
    'authenticated',
    'public.resolve_reference_data_version_for_execution(uuid,uuid,date)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service-only resolver leaked to authenticated';
  END IF;
END $$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$
DECLARE resolved record;
BEGIN
  SELECT * INTO resolved FROM public.resolve_reference_data_version_for_execution(
    'a3333333-3333-4333-8333-333333333333','a4444444-4444-4444-8444-444444444444',current_date
  );
  IF resolved.resolved_version_id <> (SELECT version_id FROM lifecycle_versions WHERE label='v1') THEN
    RAISE EXCEPTION 'service execution resolver mismatch';
  END IF;
END $$;
RESET ROLE;

SELECT 'reference_data_version_lifecycle_PASS stage=yes four_eyes=yes effective=yes projection=yes rollback=yes reject=yes tenant=yes service_resolver=yes audit=11';
ROLLBACK;
