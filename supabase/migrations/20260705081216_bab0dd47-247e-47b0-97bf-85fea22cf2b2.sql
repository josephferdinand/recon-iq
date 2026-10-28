DROP POLICY "grants updatable by tenant_admin" ON public.rbac_user_grants;
CREATE POLICY "grants updatable by tenant_admin" ON public.rbac_user_grants
FOR UPDATE
USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.tenant_id = rbac_user_grants.tenant_id AND tm.user_id = auth.uid() AND tm.role::text = 'tenant_admin' AND tm.active))
WITH CHECK (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.tenant_id = rbac_user_grants.tenant_id AND tm.user_id = auth.uid() AND tm.role::text = 'tenant_admin' AND tm.active));