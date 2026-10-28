-- A new definition cannot satisfy user_can_access_recon(id, 'edit') until the
-- row exists. Separate INSERT from existing-row UPDATE/DELETE checks so an
-- authorised tenant writer can create a definition without weakening edits.

DROP POLICY IF EXISTS recon_defs_write ON public.recon_definitions;
DROP POLICY IF EXISTS recon_defs_insert ON public.recon_definitions;
DROP POLICY IF EXISTS recon_defs_update ON public.recon_definitions;
DROP POLICY IF EXISTS recon_defs_delete ON public.recon_definitions;

CREATE POLICY recon_defs_insert ON public.recon_definitions
  FOR INSERT TO authenticated
  WITH CHECK (
    private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  );

CREATE POLICY recon_defs_update ON public.recon_definitions
  FOR UPDATE TO authenticated
  USING (
    private.user_can_access_recon(auth.uid(), id, 'edit'::text)
    AND (
      private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
      OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
    )
  )
  WITH CHECK (
    private.user_can_access_recon(auth.uid(), id, 'edit'::text)
    AND (
      private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
      OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
    )
  );

CREATE POLICY recon_defs_delete ON public.recon_definitions
  FOR DELETE TO authenticated
  USING (
    private.user_can_access_recon(auth.uid(), id, 'edit'::text)
    AND (
      private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
      OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
    )
  );
