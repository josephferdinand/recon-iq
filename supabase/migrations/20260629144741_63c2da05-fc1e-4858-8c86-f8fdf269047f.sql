
CREATE TABLE public.test_tenant_lifecycle_audit (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  tenant_slug text,
  event text NOT NULL CHECK (event IN ('create','purge','purge_failed')),
  spec_name text,
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.test_tenant_lifecycle_audit TO service_role;

ALTER TABLE public.test_tenant_lifecycle_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role only - select"
  ON public.test_tenant_lifecycle_audit FOR SELECT TO service_role USING (true);
CREATE POLICY "service role only - insert"
  ON public.test_tenant_lifecycle_audit FOR INSERT TO service_role WITH CHECK (true);

CREATE INDEX test_tenant_lifecycle_audit_tenant_idx
  ON public.test_tenant_lifecycle_audit (tenant_id, created_at DESC);
CREATE INDEX test_tenant_lifecycle_audit_spec_idx
  ON public.test_tenant_lifecycle_audit (spec_name, created_at DESC);

COMMENT ON TABLE public.test_tenant_lifecycle_audit IS
  'Append-only audit trail of ephemeral tenants minted and purged by integration tests. Lets us trace orphan-tenant accumulation back to the spec file that leaked them. Service-role only.';

-- Replace purge_test_tenant with a variant that records its action.
DROP FUNCTION IF EXISTS public.purge_test_tenant(uuid);

CREATE OR REPLACE FUNCTION public.purge_test_tenant(_tenant_id uuid, _spec_name text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _slug text;
BEGIN
  SELECT slug INTO _slug
  FROM public.tenants
  WHERE id = _tenant_id AND slug ~ '-[0-9]{13}$';

  IF _slug IS NULL THEN
    INSERT INTO public.test_tenant_lifecycle_audit (tenant_id, tenant_slug, event, spec_name, notes)
    VALUES (_tenant_id, NULL, 'purge_failed', _spec_name,
            jsonb_build_object('reason','non-test slug or not found'));
    RAISE EXCEPTION 'purge_test_tenant: refusing to delete non-test tenant %', _tenant_id
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.test_tenant_lifecycle_audit (tenant_id, tenant_slug, event, spec_name, notes)
  VALUES (_tenant_id, _slug, 'purge', _spec_name, '{}'::jsonb);

  ALTER TABLE public.tenant_members DISABLE TRIGGER USER;
  DELETE FROM public.tenants WHERE id = _tenant_id;
  ALTER TABLE public.tenant_members ENABLE TRIGGER USER;
END $$;

REVOKE ALL ON FUNCTION public.purge_test_tenant(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_test_tenant(uuid, text) TO service_role;

COMMENT ON FUNCTION public.purge_test_tenant(uuid, text) IS
  'Service-role-only teardown helper for integration tests. Refuses to delete tenants whose slug does not match the test fixture pattern (-<13 digit unix-ms>). Writes a row to test_tenant_lifecycle_audit on every call (purge or purge_failed).';
