
DROP POLICY IF EXISTS "custom_domains anon read verified minimal" ON public.tenant_custom_domains;
REVOKE SELECT ON public.tenant_custom_domains FROM anon;
