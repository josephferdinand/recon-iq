-- INSERT ... RETURNING also evaluates the SELECT policy. The existing
-- access helper looks the definition up by id, which cannot reliably see the
-- just-created row during policy evaluation. Bind creation to auth.uid() and
-- permit that creator's tenant-scoped RETURNING read directly from NEW.

DROP POLICY IF EXISTS recon_defs_insert ON public.recon_definitions;
CREATE POLICY recon_defs_insert ON public.recon_definitions
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
      OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
    )
  );

DROP POLICY IF EXISTS recon_defs_select ON public.recon_definitions;
CREATE POLICY recon_defs_select ON public.recon_definitions
  FOR SELECT TO authenticated
  USING (
    private.user_can_access_recon(auth.uid(), id, 'read'::text)
    OR (
      created_by = auth.uid()
      AND private.is_tenant_member(auth.uid(), tenant_id)
    )
  );
