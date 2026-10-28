-- Reconcile effective legacy RLS paths before governed per-definition cutover.
-- Legacy rows retain the separate definition creator-read branch and broad
-- active-member child SELECT. Governed rows have
-- no permissive legacy policy left to OR around the actor-bound decision.
-- A tenant analyst's INSERT ... RETURNING on a new unmapped draft can now be
-- denied by SELECT RLS; keep that compatibility gate closed until creation
-- atomically binds owner BUs and defines a reviewed returning contract.

CREATE OR REPLACE FUNCTION private.recon_child_read_allowed(
  _run_id uuid,
  _child_tenant_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_run public.recon_runs%ROWTYPE;
  v_definition public.recon_definitions%ROWTYPE;
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR _run_id IS NULL OR _child_tenant_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT run_row.* INTO v_run
  FROM public.recon_runs run_row
  WHERE run_row.id = _run_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT definition_row.* INTO v_definition
  FROM public.recon_definitions definition_row
  WHERE definition_row.id = v_run.definition_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Reject malformed cross-tenant ancestry for every access mode. The former
  -- child predicates trusted only the denormalized child tenant_id; preserving
  -- that behavior for legacy rows would let a child borrow another tenant's
  -- membership/platform-admin visibility through a mismatched run/root link.
  IF v_run.tenant_id IS DISTINCT FROM _child_tenant_id
     OR v_run.tenant_id IS DISTINCT FROM v_definition.tenant_id THEN
    RETURN false;
  END IF;

  -- Preserve tenant-wide legacy visibility for active members only. The
  -- platform-admin legacy branch remains separate; mapped roots use the
  -- authoritative actor-bound decision below.
  IF v_definition.access_mode = 'legacy_passthrough' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.tenant_members member_row
      WHERE member_row.user_id = v_actor
        AND member_row.tenant_id = _child_tenant_id
        AND member_row.active
    )
      OR private.is_platform_admin(v_actor);
  END IF;

  -- A governed child must agree with both its run and root tenant, then pass
  -- the current root decision. Never trust a denormalized child tenant alone.
  RETURN private.recon_authoritative_access_decision(v_definition.id, 'read');
END
$function$;

REVOKE ALL ON FUNCTION private.recon_child_read_allowed(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.recon_child_read_allowed(uuid,uuid) TO authenticated;

DROP POLICY IF EXISTS recon_defs_select_member ON public.recon_definitions;
DROP POLICY IF EXISTS recon_defs_select ON public.recon_definitions;
CREATE POLICY recon_defs_select ON public.recon_definitions
  FOR SELECT TO authenticated
  USING (
    CASE
      WHEN access_mode = 'legacy_passthrough' THEN
        private.user_can_access_recon(auth.uid(), id, 'read')
        OR (created_by = auth.uid()
          AND private.is_tenant_member(auth.uid(), tenant_id))
      ELSE private.recon_authoritative_access_decision(id, 'read')
    END
  );

DROP POLICY IF EXISTS recon_runs_select_member ON public.recon_runs;
CREATE POLICY recon_runs_select_member ON public.recon_runs
  FOR SELECT TO authenticated
  USING (private.recon_child_read_allowed(id, tenant_id));
-- The historical FOR ALL writer policy also participates in SELECT's OR
-- combination. Split it by command so the old write rules remain intact
-- without keeping a role-only SELECT bypass for governed roots.
DROP POLICY IF EXISTS recon_runs_write_analyst ON public.recon_runs;
CREATE POLICY recon_runs_insert_analyst ON public.recon_runs
  FOR INSERT TO authenticated
  WITH CHECK (
    private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  );
CREATE POLICY recon_runs_update_analyst ON public.recon_runs
  FOR UPDATE TO authenticated
  USING (
    private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  )
  WITH CHECK (
    private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  );
CREATE POLICY recon_runs_delete_analyst ON public.recon_runs
  FOR DELETE TO authenticated
  USING (
    private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  );

DROP POLICY IF EXISTS recon_matches_select_member ON public.recon_matches;
CREATE POLICY recon_matches_select_member ON public.recon_matches
  FOR SELECT TO authenticated
  USING (private.recon_child_read_allowed(run_id, tenant_id));
DROP POLICY IF EXISTS recon_matches_write_analyst ON public.recon_matches;
CREATE POLICY recon_matches_insert_analyst ON public.recon_matches
  FOR INSERT TO authenticated
  WITH CHECK (
    private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  );
CREATE POLICY recon_matches_update_analyst ON public.recon_matches
  FOR UPDATE TO authenticated
  USING (
    private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  )
  WITH CHECK (
    private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  );
CREATE POLICY recon_matches_delete_analyst ON public.recon_matches
  FOR DELETE TO authenticated
  USING (
    private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  );

DROP POLICY IF EXISTS recon_exc_select_member ON public.recon_exceptions;
CREATE POLICY recon_exc_select_member ON public.recon_exceptions
  FOR SELECT TO authenticated
  USING (private.recon_child_read_allowed(run_id, tenant_id));
DROP POLICY IF EXISTS recon_exc_write_analyst ON public.recon_exceptions;
CREATE POLICY recon_exc_insert_analyst ON public.recon_exceptions
  FOR INSERT TO authenticated
  WITH CHECK (
    private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  );
CREATE POLICY recon_exc_update_analyst ON public.recon_exceptions
  FOR UPDATE TO authenticated
  USING (
    private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  )
  WITH CHECK (
    private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  );
CREATE POLICY recon_exc_delete_analyst ON public.recon_exceptions
  FOR DELETE TO authenticated
  USING (
    private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
  );

COMMENT ON FUNCTION private.recon_child_read_allowed(uuid,uuid) IS
  'RLS helper: permits active tenant members or platform admins on legacy_passthrough children; governed children require matching child/run/root tenant ids and the actor-bound root read decision.';
