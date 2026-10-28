
-- Tighten INSERT policies on audit tables so authenticated users can't forge entries

DROP POLICY IF EXISTS "aia_insert_auth" ON public.ai_admin_audit;
CREATE POLICY "ai_admin_audit insert self-tenant only"
ON public.ai_admin_audit
FOR INSERT TO authenticated
WITH CHECK (
  actor_id = auth.uid()
  AND (
    tenant_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = ai_admin_audit.tenant_id
        AND tm.user_id = auth.uid()
    )
    OR private.is_platform_admin(auth.uid())
  )
);
CREATE POLICY "ai_admin_audit insert service_role"
ON public.ai_admin_audit
FOR INSERT TO service_role
WITH CHECK (true);

DROP POLICY IF EXISTS "audit insert" ON public.entitlement_audit_log;
CREATE POLICY "entitlement_audit_log insert self-tenant only"
ON public.entitlement_audit_log
FOR INSERT TO authenticated
WITH CHECK (
  actor_id = auth.uid()
  AND (
    tenant_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = entitlement_audit_log.tenant_id
        AND tm.user_id = auth.uid()
    )
    OR private.is_platform_admin(auth.uid())
  )
);
CREATE POLICY "entitlement_audit_log insert service_role"
ON public.entitlement_audit_log
FOR INSERT TO service_role
WITH CHECK (true);
