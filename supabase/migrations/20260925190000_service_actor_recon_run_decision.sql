-- Privileged schedule workers must preserve the same actor-bound run decision
-- as authenticated RLS. This RPC is callable only with the service-role key;
-- the caller supplies an accountable actor persisted on the schedule/job.
CREATE OR REPLACE FUNCTION public.service_recon_actor_access_decision(
  _actor_user_id uuid,
  _recon_id uuid,
  _action text
) RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, private, auth
AS $function$
DECLARE
  previous_sub text := current_setting('request.jwt.claim.sub', true);
  allowed boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     OR _actor_user_id IS NULL OR _recon_id IS NULL OR _action IS DISTINCT FROM 'run' THEN
    RETURN false;
  END IF;

  -- Reuse the canonical actor-bound evaluator without exposing an actor
  -- override to authenticated clients or changing the service role claim.
  PERFORM set_config('request.jwt.claim.sub', _actor_user_id::text, true);
  allowed := private.recon_authoritative_access_decision(_recon_id, _action);
  PERFORM set_config('request.jwt.claim.sub', coalesce(previous_sub, ''), true);
  RETURN allowed;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claim.sub', coalesce(previous_sub, ''), true);
  RAISE;
END
$function$;

REVOKE ALL ON FUNCTION public.service_recon_actor_access_decision(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_recon_actor_access_decision(uuid,uuid,text)
  TO service_role;

COMMENT ON FUNCTION public.service_recon_actor_access_decision(uuid,uuid,text) IS
  'Service-role-only worker gate. Evaluates current definition run access for the persisted accountable actor before privileged schedule writes.';

-- Bind the mutation claim to the exact tenant and definition that were
-- authorized. Locking the schedule here prevents a definition swap between
-- the read/decision and the existing atomic occurrence claim.
CREATE OR REPLACE FUNCTION public.claim_recon_schedule_run_for_definition(
  _tenant_id uuid,
  _definition_id uuid,
  _schedule_id uuid,
  _trigger text,
  _scheduled_for timestamptz,
  _occurrence_key text,
  _attempt integer,
  _actor_user_id uuid,
  _parent_run_id bigint
) RETURNS TABLE(schedule_run_id bigint, disposition text, run_attempt integer, allowed_attempts integer)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  bound_schedule public.recon_schedules%ROWTYPE;
BEGIN
  IF _tenant_id IS NULL OR _definition_id IS NULL OR _actor_user_id IS NULL THEN
    RAISE EXCEPTION 'tenant, definition, and accountable actor are required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO bound_schedule
  FROM public.recon_schedules schedule_row
  WHERE schedule_row.id = _schedule_id
    AND schedule_row.tenant_id = _tenant_id
    AND schedule_row.definition_id = _definition_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'schedule scope changed or not found' USING ERRCODE='P0002'; END IF;
  IF NOT public.service_recon_actor_access_decision(_actor_user_id, _definition_id, 'run') THEN
    RAISE EXCEPTION 'reconciliation run is not authorized' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  SELECT * FROM public.claim_recon_schedule_run(
    _schedule_id, _trigger, _scheduled_for, _occurrence_key,
    _attempt, _actor_user_id, _parent_run_id
  );
END
$function$;

REVOKE ALL ON FUNCTION public.claim_recon_schedule_run_for_definition(
  uuid,uuid,uuid,text,timestamptz,text,integer,uuid,bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_recon_schedule_run_for_definition(
  uuid,uuid,uuid,text,timestamptz,text,integer,uuid,bigint
) TO service_role;

-- Set the actor claim only inside this service-role-only transaction so the
-- existing governance trigger can verify the same authenticated run actor.
-- The actor decision is repeated immediately before the protected INSERT.
CREATE OR REPLACE FUNCTION public.create_recon_run_for_actor(
  _tenant_id uuid,
  _definition_id uuid,
  _actor_user_id uuid
) RETURNS TABLE(id uuid, run_uid text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $function$
DECLARE
  previous_sub text := current_setting('request.jwt.claim.sub', true);
  created_id uuid;
  created_run_uid text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     OR _tenant_id IS NULL OR _definition_id IS NULL OR _actor_user_id IS NULL THEN
    RAISE EXCEPTION 'tenant, definition, and accountable service actor are required' USING ERRCODE='42501';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', _actor_user_id::text, true);
  IF NOT private.recon_authoritative_access_decision(_definition_id, 'run')
     OR NOT EXISTS (
       SELECT 1 FROM public.recon_definitions definition_row
       WHERE definition_row.id = _definition_id AND definition_row.tenant_id = _tenant_id
     ) THEN
    RAISE EXCEPTION 'reconciliation run is not authorized' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.recon_runs(tenant_id, definition_id, status, run_by)
  VALUES (_tenant_id, _definition_id, 'running', _actor_user_id)
  RETURNING recon_runs.id, recon_runs.run_uid INTO created_id, created_run_uid;
  PERFORM set_config('request.jwt.claim.sub', coalesce(previous_sub, ''), true);
  RETURN QUERY SELECT created_id, created_run_uid;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claim.sub', coalesce(previous_sub, ''), true);
  RAISE;
END
$function$;

REVOKE ALL ON FUNCTION public.create_recon_run_for_actor(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_recon_run_for_actor(uuid,uuid,uuid)
  TO service_role;
