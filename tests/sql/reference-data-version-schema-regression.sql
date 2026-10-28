\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email,created_at,updated_at)
VALUES
  ('91111111-1111-4111-8111-111111111111','reference-version-owner@invalid.test',now(),now()),
  ('95555555-5555-4555-8555-555555555555','reference-version-foreign@invalid.test',now(),now());
INSERT INTO public.tenants(id,slug,name,created_by)
VALUES
  ('92222222-2222-4222-8222-222222222222','reference-version-owner','Reference Version Owner','91111111-1111-4111-8111-111111111111'),
  ('96666666-6666-4666-8666-666666666666','reference-version-foreign','Reference Version Foreign','95555555-5555-4555-8555-555555555555');
INSERT INTO public.tenant_members(tenant_id,user_id,role)
VALUES
  ('92222222-2222-4222-8222-222222222222','91111111-1111-4111-8111-111111111111','tenant_admin'),
  ('96666666-6666-4666-8666-666666666666','95555555-5555-4555-8555-555555555555','tenant_admin');
INSERT INTO public.reference_data_tables(id,tenant_id,name,key_columns,value_columns,created_by)
VALUES
  ('93333333-3333-4333-8333-333333333333','92222222-2222-4222-8222-222222222222','Versioned currencies',ARRAY['currency','region'],ARRAY['canonical_currency'],'91111111-1111-4111-8111-111111111111'),
  ('97777777-7777-4777-8777-777777777777','96666666-6666-4666-8666-666666666666','Foreign version table',ARRAY['currency'],ARRAY['name'],'95555555-5555-4555-8555-555555555555');

INSERT INTO public.reference_data_versions(
  id,tenant_id,table_id,version_number,status,effective_from,change_note,created_by
) VALUES (
  '94444444-4444-4444-8444-444444444444',
  '92222222-2222-4222-8222-222222222222',
  '93333333-3333-4333-8333-333333333333',
  1,'draft','2026-09-01','Initial governed currency mapping',
  '91111111-1111-4111-8111-111111111111'
);
INSERT INTO public.reference_data_version_rows(
  version_id,tenant_id,table_id,row_data,key_hash
) VALUES (
  '94444444-4444-4444-8444-444444444444',
  '92222222-2222-4222-8222-222222222222',
  '93333333-3333-4333-8333-333333333333',
  '{"currency":"USD","region":"US","canonical_currency":"USD"}',
  repeat('0',64)
);

DO $$
BEGIN
  IF (SELECT length(key_hash) FROM public.reference_data_version_rows WHERE version_id='94444444-4444-4444-8444-444444444444') <> 64 THEN
    RAISE EXCEPTION 'version key hash missing';
  END IF;
  IF (SELECT key_hash FROM public.reference_data_version_rows WHERE version_id='94444444-4444-4444-8444-444444444444') = repeat('0',64) THEN
    RAISE EXCEPTION 'caller supplied key hash was not replaced';
  END IF;

  BEGIN
    INSERT INTO public.reference_data_version_rows(version_id,tenant_id,table_id,row_data,key_hash)
    VALUES ('94444444-4444-4444-8444-444444444444','92222222-2222-4222-8222-222222222222','93333333-3333-4333-8333-333333333333','{"currency":"USD","region":"US","canonical_currency":"USX"}',repeat('0',64));
    RAISE EXCEPTION 'duplicate composite key unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.reference_data_version_rows(version_id,tenant_id,table_id,row_data,key_hash)
    VALUES ('94444444-4444-4444-8444-444444444444','96666666-6666-4666-8666-666666666666','93333333-3333-4333-8333-333333333333','{"currency":"EUR","region":"EU"}',repeat('0',64));
    RAISE EXCEPTION 'cross-tenant version row unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'cross-tenant version row unexpectedly accepted' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.reference_data_version_rows SET row_data='{"currency":"GBP","region":"GB"}' WHERE version_id='94444444-4444-4444-8444-444444444444';
    RAISE EXCEPTION 'immutable row update unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'immutable row update unexpectedly accepted' THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM public.reference_data_version_rows WHERE version_id='94444444-4444-4444-8444-444444444444';
    RAISE EXCEPTION 'immutable row delete unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'immutable row delete unexpectedly accepted' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO public.reference_data_versions(tenant_id,table_id,version_number,status,effective_from,change_note,created_by,submitted_by)
    VALUES ('92222222-2222-4222-8222-222222222222','93333333-3333-4333-8333-333333333333',2,'pending_approval','2026-10-01','First pending version','91111111-1111-4111-8111-111111111111','91111111-1111-4111-8111-111111111111');
    INSERT INTO public.reference_data_versions(tenant_id,table_id,version_number,status,effective_from,change_note,created_by,submitted_by)
    VALUES ('92222222-2222-4222-8222-222222222222','93333333-3333-4333-8333-333333333333',3,'pending_approval','2026-11-01','Second pending version','91111111-1111-4111-8111-111111111111','91111111-1111-4111-8111-111111111111');
    RAISE EXCEPTION 'second pending version unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.reference_data_versions(tenant_id,table_id,version_number,status,effective_from,effective_to,change_note,created_by)
    VALUES ('92222222-2222-4222-8222-222222222222','93333333-3333-4333-8333-333333333333',4,'draft','2026-12-31','2026-01-01','Invalid interval','91111111-1111-4111-8111-111111111111');
    RAISE EXCEPTION 'invalid effective interval unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','95555555-5555-4555-8555-555555555555',true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.reference_data_versions WHERE id='94444444-4444-4444-8444-444444444444') <> 0 THEN
    RAISE EXCEPTION 'foreign tenant version leak';
  END IF;
  IF (SELECT count(*) FROM public.reference_data_version_rows WHERE version_id='94444444-4444-4444-8444-444444444444') <> 0 THEN
    RAISE EXCEPTION 'foreign tenant version-row leak';
  END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','91111111-1111-4111-8111-111111111111',true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.reference_data_versions WHERE id='94444444-4444-4444-8444-444444444444') <> 1 THEN
    RAISE EXCEPTION 'own version hidden';
  END IF;
  IF (SELECT count(*) FROM public.reference_data_version_rows WHERE version_id='94444444-4444-4444-8444-444444444444') <> 1 THEN
    RAISE EXCEPTION 'own version row hidden';
  END IF;
  IF has_table_privilege('authenticated','public.reference_data_versions','INSERT') THEN
    RAISE EXCEPTION 'authenticated direct version write leaked';
  END IF;
  IF has_table_privilege('authenticated','public.reference_data_version_rows','INSERT') THEN
    RAISE EXCEPTION 'authenticated direct version-row write leaked';
  END IF;
END $$;
RESET ROLE;

SELECT 'reference_data_version_schema_PASS tenant=yes immutable=yes duplicate=yes pending=yes interval=yes rls=yes';
ROLLBACK;
