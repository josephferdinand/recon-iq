
-- Restrict tenant_sso_configs SELECT to tenant_admin or platform_admin
DROP POLICY IF EXISTS sso_read ON public.tenant_sso_configs;
CREATE POLICY sso_read ON public.tenant_sso_configs
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
  );

-- Restrict tenant_idp_configs SELECT to tenant_admin or platform_admin
DROP POLICY IF EXISTS "tidp read" ON public.tenant_idp_configs;
CREATE POLICY "tidp read" ON public.tenant_idp_configs
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
  );
