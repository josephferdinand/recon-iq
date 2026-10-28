-- Root definition writes must use the same actor-bound BU decision as reads,
-- runs, and child writes. Keep the historical role/helper behavior only for
-- rows that remain in legacy passthrough.

DROP POLICY IF EXISTS recon_defs_update ON public.recon_definitions;
CREATE POLICY recon_defs_update ON public.recon_definitions
  FOR UPDATE TO authenticated
  USING (
    CASE
      WHEN access_mode = 'legacy_passthrough' THEN
        private.user_can_access_recon(auth.uid(), id, 'edit'::text)
        AND (
          private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
          OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
        )
      ELSE private.recon_authoritative_access_decision(id, 'edit')
    END
  )
  WITH CHECK (
    CASE
      WHEN access_mode = 'legacy_passthrough' THEN
        private.user_can_access_recon(auth.uid(), id, 'edit'::text)
        AND (
          private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
          OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
        )
      ELSE private.recon_authoritative_access_decision(id, 'edit')
    END
  );

DROP POLICY IF EXISTS recon_defs_delete ON public.recon_definitions;
CREATE POLICY recon_defs_delete ON public.recon_definitions
  FOR DELETE TO authenticated
  USING (
    status = 'draft'
    AND retired_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.recon_runs run_row
      WHERE run_row.definition_id = recon_definitions.id
    )
    AND access_mode = 'legacy_passthrough'
    AND private.user_can_access_recon(auth.uid(), id, 'edit'::text)
    AND EXISTS (
      SELECT 1 FROM public.tenant_members member_row
      WHERE member_row.tenant_id = recon_definitions.tenant_id
        AND member_row.user_id = auth.uid() AND member_row.active = true
    )
    AND (
      private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
      OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
    )
  );

COMMENT ON POLICY recon_defs_update ON public.recon_definitions IS
  'Legacy rows retain the tenant-role/helper rule; mapped or governed rows require the authenticated actor bound to the current owner-BU edit decision.';
COMMENT ON POLICY recon_defs_delete ON public.recon_definitions IS
  'Physical deletion remains limited to unretired legacy_passthrough drafts without runs; mapped or governed definitions are retained for governed lifecycle handling.';
