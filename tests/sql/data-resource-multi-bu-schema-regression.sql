-- Disposable ordered-migration contract checks; no tenant/resource rows are created.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'data_resource_business_unit_owners', 'data_resource_owner_audit',
    'data_resource_bu_grants', 'data_resource_grant_audit'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r' AND c.relrowsecurity
    ) THEN RAISE EXCEPTION 'missing table or RLS disabled: %', t; END IF;
    IF has_table_privilege('authenticated', format('public.%I', t), 'SELECT')
       OR has_table_privilege('authenticated', format('public.%I', t), 'INSERT')
       OR has_table_privilege('anon', format('public.%I', t), 'SELECT') THEN
      RAISE EXCEPTION 'shadow ledger exposed to API role: %', t;
    END IF;
    IF NOT has_table_privilege('service_role', format('public.%I', t), 'SELECT') THEN
      RAISE EXCEPTION 'service role missing shadow ledger read: %', t;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'data_resource_owner_bu_tenant_fk'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'data_resource_bu_grant_owner_fk'
  ) THEN RAISE EXCEPTION 'tenant/owner composite foreign keys missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'data_resource_owner_validate' AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'data_resource_grant_validate' AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'data_resource_owner_immutable' AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'data_resource_grant_immutable' AND NOT tgisinternal
  ) THEN RAISE EXCEPTION 'validation or immutable-ledger trigger missing'; END IF;
  IF (SELECT count(*) FROM public.data_resource_business_unit_owners) <> 0
     OR (SELECT count(*) FROM public.data_resource_bu_grants) <> 0 THEN
    RAISE EXCEPTION 'shadow metadata unexpectedly populated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polrelid = 'public.workspace_data_sources'::regclass
      AND polname = 'data_sources_select_member'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polrelid = 'public.data_watchers'::regclass
      AND polname = 'dw_read'
  ) THEN RAISE EXCEPTION 'legacy resource policies unexpectedly absent or changed'; END IF;
END $$;
