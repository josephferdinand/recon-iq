-- Narrow the already-hosted audit tenant read policy before the unrelated
-- importer and reconciliation migration chain. This changes SELECT only.
-- The later 20260927104500 policy migration intentionally reasserts the same
-- rule after the full ordered chain is installed.

DROP POLICY IF EXISTS audit_tenant_read ON public.audit_log;
CREATE POLICY audit_tenant_read ON public.audit_log
  FOR SELECT TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tenant_members member
      WHERE member.tenant_id = audit_log.tenant_id
        AND member.user_id = (SELECT auth.uid())
        AND member.active = true
    )
    AND (
      actor_user_id = (SELECT auth.uid())
      OR public.has_tenant_role((SELECT auth.uid()), tenant_id, 'tenant_admin'::public.tenant_role)
      OR public.user_has_permission((SELECT auth.uid()), tenant_id, 'audit.log.read', NULL)
    )
  );

COMMENT ON POLICY audit_tenant_read ON public.audit_log IS
  'Active ordinary tenant members see own actor rows; active tenant admins and audit.log.read grantees retain tenant forensics. Platform read remains separate.';
