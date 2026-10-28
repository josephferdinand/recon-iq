
-- Fix 1: schema_per_tenant_requests - restrict UPDATE to tenant_admin/platform_admin and block self-approval
DROP POLICY IF EXISTS sptr_update ON public.schema_per_tenant_requests;
CREATE POLICY sptr_update ON public.schema_per_tenant_requests
  FOR UPDATE
  USING (
    public.is_platform_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
  )
  WITH CHECK (
    (
      public.is_platform_admin(auth.uid())
      OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    )
    AND (decided_by IS NULL OR decided_by <> requested_by)
    AND (decided_by IS NULL OR decided_by = auth.uid() OR public.is_platform_admin(auth.uid()))
  );

-- Fix 2: tenant_silo_assignments - restrict UPDATE to tenant_admin/platform_admin
DROP POLICY IF EXISTS tsa_update ON public.tenant_silo_assignments;
CREATE POLICY tsa_update ON public.tenant_silo_assignments
  FOR UPDATE
  USING (
    public.is_platform_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
  )
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
  );

-- Fix 3: github_sync_change_requests - enforce dual-control (requester cannot be approver)
DROP POLICY IF EXISTS "platform admins update change requests" ON public.github_sync_change_requests;
CREATE POLICY "platform admins update change requests" ON public.github_sync_change_requests
  FOR UPDATE
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    AND (approver_1 IS NULL OR approver_1 <> requested_by)
    AND (approver_2 IS NULL OR approver_2 <> requested_by)
    AND (approver_2 IS NULL OR approver_1 IS NULL OR approver_2 <> approver_1)
  );
