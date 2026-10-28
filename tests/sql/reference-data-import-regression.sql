\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email,created_at,updated_at)
VALUES
  ('81111111-1111-4111-8111-111111111111','reference-owner@invalid.test',now(),now()),
  ('85555555-5555-4555-8555-555555555555','reference-foreign@invalid.test',now(),now());
INSERT INTO public.tenants(id,slug,name,created_by)
VALUES
  ('82222222-2222-4222-8222-222222222222','reference-owner','Reference Owner','81111111-1111-4111-8111-111111111111'),
  ('86666666-6666-4666-8666-666666666666','reference-foreign','Reference Foreign','85555555-5555-4555-8555-555555555555');
INSERT INTO public.tenant_members(tenant_id,user_id,role)
VALUES
  ('82222222-2222-4222-8222-222222222222','81111111-1111-4111-8111-111111111111','tenant_admin'),
  ('86666666-6666-4666-8666-666666666666','85555555-5555-4555-8555-555555555555','tenant_admin');
INSERT INTO public.reference_data_tables(id,tenant_id,name,key_columns,value_columns,created_by)
VALUES
  ('83333333-3333-4333-8333-333333333333','82222222-2222-4222-8222-222222222222','Currency by region',ARRAY['currency','region'],ARRAY['settlement_days'],'81111111-1111-4111-8111-111111111111'),
  ('87777777-7777-4777-8777-777777777777','86666666-6666-4666-8666-666666666666','Foreign currencies',ARRAY['currency'],ARRAY['name'],'85555555-5555-4555-8555-555555555555');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub','81111111-1111-4111-8111-111111111111',true);

SELECT * FROM public.bulk_import_reference_data(
  '82222222-2222-4222-8222-222222222222',
  '83333333-3333-4333-8333-333333333333',
  '[{"currency":"USD","region":"US","settlement_days":1},{"currency":"EUR","region":"EU","settlement_days":2}]',
  true
);
SELECT * FROM public.bulk_import_reference_data(
  '82222222-2222-4222-8222-222222222222',
  '83333333-3333-4333-8333-333333333333',
  '[{"currency":"GBP","region":"GB","settlement_days":2}]',
  false
);

DO $$
BEGIN
  BEGIN
    PERFORM * FROM public.bulk_import_reference_data(
      '82222222-2222-4222-8222-222222222222',
      '83333333-3333-4333-8333-333333333333',
      '[{"currency":"USD","region":"US","settlement_days":9},{"currency":"USD","region":"US","settlement_days":10}]',
      true
    );
    RAISE EXCEPTION 'duplicate replace unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    PERFORM * FROM public.bulk_import_reference_data(
      '82222222-2222-4222-8222-222222222222',
      '83333333-3333-4333-8333-333333333333',
      '[{"currency":"JPY","settlement_days":2}]',
      true
    );
    RAISE EXCEPTION 'missing composite key unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'missing composite key unexpectedly accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM public.bulk_import_reference_data(
      '82222222-2222-4222-8222-222222222222',
      '87777777-7777-4777-8777-777777777777',
      '[{"currency":"USD","name":"US Dollar"}]',
      false
    );
    RAISE EXCEPTION 'cross-tenant table unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'cross-tenant table unexpectedly accepted' THEN RAISE; END IF;
  END;

  IF (SELECT count(*) FROM public.reference_data_rows WHERE table_id='83333333-3333-4333-8333-333333333333') <> 3 THEN
    RAISE EXCEPTION 'atomicity or row count mismatch';
  END IF;
  IF (SELECT row_count FROM public.reference_data_tables WHERE id='83333333-3333-4333-8333-333333333333') <> 3 THEN
    RAISE EXCEPTION 'table total mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.reference_data_rows
    WHERE table_id='83333333-3333-4333-8333-333333333333'
      AND (key_hash IS NULL OR length(key_hash) <> 64)
  ) THEN
    RAISE EXCEPTION 'deterministic key hash missing';
  END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE tenant_id='82222222-2222-4222-8222-222222222222' AND action='reference_data.bulk_load') <> 2 THEN
    RAISE EXCEPTION 'audit count mismatch';
  END IF;
  IF has_function_privilege('anon','public.bulk_import_reference_data(uuid,uuid,jsonb,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'anonymous execution leaked';
  END IF;
  IF has_function_privilege('authenticated','public.bulk_import_reference_data(uuid,uuid,jsonb,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated legacy publication privilege leaked';
  END IF;
END $$;

SELECT 'reference_data_import_PASS rows=3 atomic=yes composite_key=yes tenant_isolation=yes audit=2 service_only=yes';
ROLLBACK;
