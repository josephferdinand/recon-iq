CREATE OR REPLACE FUNCTION public.purge_test_tenant(_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Safety: only allow slugs that match the test fixture pattern (timestamped suffix)
  IF NOT EXISTS (
    SELECT 1 FROM public.tenants
    WHERE id = _tenant_id AND slug ~ '-[0-9]{13}$'
  ) THEN
    RAISE EXCEPTION 'purge_test_tenant: refusing to delete non-test tenant %', _tenant_id
      USING ERRCODE = '42501';
  END IF;

  ALTER TABLE public.tenant_members DISABLE TRIGGER USER;
  DELETE FROM public.tenants WHERE id = _tenant_id;
  ALTER TABLE public.tenant_members ENABLE TRIGGER USER;
END $$;

REVOKE ALL ON FUNCTION public.purge_test_tenant(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_test_tenant(uuid) TO service_role;

COMMENT ON FUNCTION public.purge_test_tenant(uuid) IS
  'Service-role-only teardown helper for integration tests. Refuses to delete tenants whose slug does not match the test fixture pattern (-<13 digit unix-ms>).';