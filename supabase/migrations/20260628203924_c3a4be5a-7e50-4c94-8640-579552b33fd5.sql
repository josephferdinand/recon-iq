CREATE OR REPLACE FUNCTION public.dump_public_schema_ddl()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_out text;
BEGIN
  SELECT string_agg(ddl, E'\n\n' ORDER BY ord)
  INTO v_out
  FROM (
    SELECT 1 AS ord, '-- FVI schema dump generated ' || now()::text AS ddl
    UNION ALL
    SELECT 2, 'SET statement_timeout = 0;'
    UNION ALL
    SELECT 3, pg_catalog.pg_get_viewdef(v.oid, true)
    FROM pg_class v WHERE v.relkind = 'v' AND v.relnamespace =
      (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    UNION ALL
    SELECT 4, pg_catalog.pg_get_functiondef(p.oid)
    FROM pg_proc p WHERE p.pronamespace =
      (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND p.prokind = 'f'
  ) sub;
  RETURN COALESCE(v_out, '-- No schema objects found');
END $$;

REVOKE ALL ON FUNCTION public.dump_public_schema_ddl() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dump_public_schema_ddl() TO service_role;