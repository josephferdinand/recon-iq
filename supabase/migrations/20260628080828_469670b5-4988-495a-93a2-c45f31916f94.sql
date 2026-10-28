
-- LLM providers: belt-and-braces restrictive gate on all reads/writes
DROP POLICY IF EXISTS llm_providers_admin_only ON public.llm_providers;
CREATE POLICY llm_providers_admin_only ON public.llm_providers
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR (scope = 'tenant'::llm_scope
        AND tenant_id IS NOT NULL
        AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
  )
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR (scope = 'tenant'::llm_scope
        AND tenant_id IS NOT NULL
        AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
  );

-- Tenant members: allow co-members of the same tenant to see each other
DROP POLICY IF EXISTS tenant_members_read_co_members ON public.tenant_members;
CREATE POLICY tenant_members_read_co_members ON public.tenant_members
  FOR SELECT
  TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));
