-- Workspace personal history is actor-scoped. Retain tenant-wide forensic reads
-- only for active tenant administrators and explicit audit.log.read grantees;
-- platform audit stays under the separate existing audit_platform_read policy.
-- This migration is source-only until the ordered hosted predecessor chain is
-- reviewed and applied. Do not apply it in isolation.

DROP POLICY IF EXISTS audit_tenant_read ON public.audit_log;
CREATE POLICY audit_tenant_read ON public.audit_log
  FOR SELECT TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.tenant_members member
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
  'Ordinary active tenant users read only their own actor rows. Active tenant admins and explicit audit.log.read grantees retain tenant-wide forensic access; platform policy is separate.';
