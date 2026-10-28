-- Governed reconciliation writes follow actor-bound run/edit decisions.
-- Legacy rows retain tenant-role write compatibility. All paths require the
-- child/run/root tenant chain to agree. INSERTs require read in addition to
-- run because PostgREST INSERT ... RETURNING is evaluated by SELECT RLS.

-- A run's current SELECT helper looks up the run row by id. During
-- INSERT ... RETURNING, that row is not yet visible to the lookup, so the
-- existing helper denies the INSERT even when the root grants read. Evaluate
-- the same root/tenant decision directly from the candidate row instead.
CREATE OR REPLACE FUNCTION private.recon_run_read_allowed(
  _definition_id uuid,
  _run_tenant_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_definition public.recon_definitions%ROWTYPE;
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR _definition_id IS NULL OR _run_tenant_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT d.* INTO v_definition
  FROM public.recon_definitions d
  WHERE d.id = _definition_id;
  IF NOT FOUND OR v_definition.tenant_id IS DISTINCT FROM _run_tenant_id THEN
    RETURN false;
  END IF;

  IF v_definition.access_mode = 'legacy_passthrough' THEN
    RETURN private.is_tenant_member(v_actor, _run_tenant_id)
      OR private.is_platform_admin(v_actor);
  END IF;

  RETURN private.recon_authoritative_access_decision(v_definition.id, 'read');
END
$function$;

CREATE OR REPLACE FUNCTION private.recon_root_write_allowed(
  _definition_id uuid,
  _tenant_id uuid,
  _action text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_definition public.recon_definitions%ROWTYPE;
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR _definition_id IS NULL OR _tenant_id IS NULL OR _action IS NULL
     OR _action NOT IN ('run','edit') THEN
    RETURN false;
  END IF;

  SELECT d.* INTO v_definition
  FROM public.recon_definitions d
  WHERE d.id = _definition_id;
  IF NOT FOUND OR v_definition.tenant_id IS DISTINCT FROM _tenant_id THEN
    RETURN false;
  END IF;

  -- Legacy write policy was tenant_admin/tenant_analyst. Keep that behavior
  -- for valid legacy ancestry; platform-only read visibility is not write.
  IF v_definition.access_mode = 'legacy_passthrough' THEN
    RETURN private.has_tenant_role(v_actor, _tenant_id, 'tenant_admin'::tenant_role)
      OR private.has_tenant_role(v_actor, _tenant_id, 'tenant_analyst'::tenant_role);
  END IF;

  -- A mutation must be usable through the row's SELECT policy too. `run`
  -- inserts need read for RETURNING; `edit` changes need read to locate and
  -- operate on the existing row. Missing either capability fails closed.
  RETURN private.recon_authoritative_access_decision(v_definition.id, _action)
     AND private.recon_authoritative_access_decision(v_definition.id, 'read');
END
$function$;

CREATE OR REPLACE FUNCTION private.recon_child_write_allowed(
  _run_id uuid,
  _child_tenant_id uuid,
  _action text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_run public.recon_runs%ROWTYPE;
BEGIN
  IF _run_id IS NULL OR _child_tenant_id IS NULL OR _action IS NULL
     OR _action NOT IN ('run','edit') THEN
    RETURN false;
  END IF;

  SELECT r.* INTO v_run
  FROM public.recon_runs r
  WHERE r.id = _run_id;
  IF NOT FOUND OR v_run.tenant_id IS DISTINCT FROM _child_tenant_id THEN
    RETURN false;
  END IF;

  -- The root helper independently confirms root tenant equality before it
  -- evaluates legacy role compatibility or the governed actor decision.
  RETURN private.recon_root_write_allowed(v_run.definition_id, _child_tenant_id, _action);
END
$function$;

REVOKE ALL ON FUNCTION private.recon_root_write_allowed(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.recon_child_write_allowed(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.recon_run_read_allowed(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.recon_root_write_allowed(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.recon_child_write_allowed(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.recon_run_read_allowed(uuid,uuid) TO authenticated;

DROP POLICY IF EXISTS recon_runs_select_member ON public.recon_runs;
CREATE POLICY recon_runs_select_member ON public.recon_runs
  FOR SELECT TO authenticated
  USING (private.recon_run_read_allowed(definition_id, tenant_id));

-- The run row itself carries the root id and tenant. UPDATE/DELETE resolve
-- this chain inside the SECURITY DEFINER helper, including when the caller's
-- root SELECT policy would otherwise hide the root.
DROP POLICY IF EXISTS recon_runs_insert_analyst ON public.recon_runs;
DROP POLICY IF EXISTS recon_runs_update_analyst ON public.recon_runs;
DROP POLICY IF EXISTS recon_runs_delete_analyst ON public.recon_runs;
CREATE POLICY recon_runs_insert_access ON public.recon_runs
  FOR INSERT TO authenticated
  WITH CHECK (private.recon_root_write_allowed(definition_id, tenant_id, 'run'));
CREATE POLICY recon_runs_update_access ON public.recon_runs
  FOR UPDATE TO authenticated
  USING (private.recon_root_write_allowed(definition_id, tenant_id, 'edit'))
  WITH CHECK (private.recon_root_write_allowed(definition_id, tenant_id, 'edit'));
CREATE POLICY recon_runs_delete_access ON public.recon_runs
  FOR DELETE TO authenticated
  USING (private.recon_root_write_allowed(definition_id, tenant_id, 'edit'));

DROP POLICY IF EXISTS recon_matches_insert_analyst ON public.recon_matches;
DROP POLICY IF EXISTS recon_matches_update_analyst ON public.recon_matches;
DROP POLICY IF EXISTS recon_matches_delete_analyst ON public.recon_matches;
CREATE POLICY recon_matches_insert_access ON public.recon_matches
  FOR INSERT TO authenticated
  WITH CHECK (private.recon_child_write_allowed(run_id, tenant_id, 'run'));
CREATE POLICY recon_matches_update_access ON public.recon_matches
  FOR UPDATE TO authenticated
  USING (private.recon_child_write_allowed(run_id, tenant_id, 'edit'))
  WITH CHECK (private.recon_child_write_allowed(run_id, tenant_id, 'edit'));
CREATE POLICY recon_matches_delete_access ON public.recon_matches
  FOR DELETE TO authenticated
  USING (private.recon_child_write_allowed(run_id, tenant_id, 'edit'));

DROP POLICY IF EXISTS recon_exc_insert_analyst ON public.recon_exceptions;
DROP POLICY IF EXISTS recon_exc_update_analyst ON public.recon_exceptions;
DROP POLICY IF EXISTS recon_exc_delete_analyst ON public.recon_exceptions;
CREATE POLICY recon_exc_insert_access ON public.recon_exceptions
  FOR INSERT TO authenticated
  WITH CHECK (private.recon_child_write_allowed(run_id, tenant_id, 'run'));
CREATE POLICY recon_exc_update_access ON public.recon_exceptions
  FOR UPDATE TO authenticated
  USING (private.recon_child_write_allowed(run_id, tenant_id, 'edit'))
  WITH CHECK (private.recon_child_write_allowed(run_id, tenant_id, 'edit'));
CREATE POLICY recon_exc_delete_access ON public.recon_exceptions
  FOR DELETE TO authenticated
  USING (private.recon_child_write_allowed(run_id, tenant_id, 'edit'));

COMMENT ON FUNCTION private.recon_root_write_allowed(uuid,uuid,text) IS
  'RLS helper: valid tenant-bound legacy writes retain tenant-role behavior; governed writes require actor-bound run/edit and read decisions.';
COMMENT ON FUNCTION private.recon_child_write_allowed(uuid,uuid,text) IS
  'RLS helper: verifies child/run/root tenant equality, then delegates to the tenant-bound legacy/governed write decision.';
