
-- Drop the coarse role-only policy that ORs around the fine-grained recon_permissions check
DROP POLICY IF EXISTS recon_defs_write_analyst ON public.recon_definitions;

-- Enforce maker/checker on bulk_resolution_jobs approvals
DROP POLICY IF EXISTS "brj update" ON public.bulk_resolution_jobs;
CREATE POLICY "brj update" ON public.bulk_resolution_jobs
  FOR UPDATE
  USING (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
  WITH CHECK (
    has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    AND (approved_by IS NULL OR approved_by <> created_by)
  );
