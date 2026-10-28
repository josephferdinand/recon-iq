
-- 1. Tighten SELECT on rekon_db_connections (analyst+ only)
DROP POLICY IF EXISTS "tenant members read db conns" ON public.rekon_db_connections;
CREATE POLICY "tenant writers read db conns" ON public.rekon_db_connections
  FOR SELECT TO authenticated USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  );

-- 2. Tighten SELECT on rekon_inline_api_sources (analyst+ only)
DROP POLICY IF EXISTS "tenant members read api sources" ON public.rekon_inline_api_sources;
CREATE POLICY "tenant writers read api sources" ON public.rekon_inline_api_sources
  FOR SELECT TO authenticated USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  );

-- 3. Tighten SELECT on reporting_db_exports (admin only)
DROP POLICY IF EXISTS rde_read ON public.reporting_db_exports;
CREATE POLICY rde_read ON public.reporting_db_exports
  FOR SELECT TO authenticated USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
    public.is_platform_admin(auth.uid())
  );

-- 4. Restrict tenant LLM provider rows (which include key_secret_name) to admins
DROP POLICY IF EXISTS "tenant members read tenant llm via view" ON public.llm_providers;
CREATE POLICY "tenant admins read tenant llm" ON public.llm_providers
  FOR SELECT TO authenticated USING (
    scope = 'tenant'::llm_scope AND (
      public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR
      public.is_platform_admin(auth.uid())
    )
  );

-- 5. Revoke direct EXECUTE on internal SECURITY DEFINER helpers
REVOKE EXECUTE ON FUNCTION public.effective_retention_days(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.user_bu_scope(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.user_can_access_bu(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.status_confirm_subscriber(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.status_unsubscribe(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.status_overall() FROM PUBLIC, anon, authenticated;
