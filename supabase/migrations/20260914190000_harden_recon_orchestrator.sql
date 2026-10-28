-- Durable Recon Orchestrator claims, retries, overlap protection and catch-up cursor.

ALTER TABLE public.recon_schedules
  ADD COLUMN IF NOT EXISTS max_attempts smallint NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS retry_backoff_seconds integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS catch_up_window_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS last_dispatched_for timestamptz;

UPDATE public.recon_schedules
SET last_dispatched_for = date_trunc('minute', now())
WHERE last_dispatched_for IS NULL;

ALTER TABLE public.recon_schedules
  ALTER COLUMN last_dispatched_for SET DEFAULT date_trunc('minute', now()),
  ALTER COLUMN last_dispatched_for SET NOT NULL,
  DROP CONSTRAINT IF EXISTS recon_schedules_max_attempts_check,
  DROP CONSTRAINT IF EXISTS recon_schedules_retry_backoff_check,
  DROP CONSTRAINT IF EXISTS recon_schedules_catch_up_window_check,
  ADD CONSTRAINT recon_schedules_max_attempts_check CHECK (max_attempts BETWEEN 1 AND 5),
  ADD CONSTRAINT recon_schedules_retry_backoff_check CHECK (retry_backoff_seconds BETWEEN 1 AND 3600),
  ADD CONSTRAINT recon_schedules_catch_up_window_check CHECK (catch_up_window_minutes BETWEEN 1 AND 1440);

ALTER TABLE public.recon_schedule_runs
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS occurrence_key text,
  ADD COLUMN IF NOT EXISTS attempt smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_attempts smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS retry_after timestamptz,
  ADD COLUMN IF NOT EXISTS retry_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by_id bigint REFERENCES public.recon_schedule_runs(id),
  ADD COLUMN IF NOT EXISTS actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

UPDATE public.recon_schedule_runs
SET scheduled_for = date_trunc('minute', started_at),
    occurrence_key = 'legacy:' || id::text,
    lease_expires_at = CASE WHEN status = 'running' THEN started_at + interval '2 hours' END
WHERE scheduled_for IS NULL OR occurrence_key IS NULL;

WITH overlapping AS (
  SELECT id, row_number() OVER (PARTITION BY schedule_id ORDER BY started_at DESC, id DESC) AS rn
  FROM public.recon_schedule_runs
  WHERE status = 'running'
)
UPDATE public.recon_schedule_runs r
SET status = 'failed',
    finished_at = now(),
    error = 'legacy_overlap_closed_during_orchestrator_hardening'
FROM overlapping o
WHERE r.id = o.id AND o.rn > 1;

ALTER TABLE public.recon_schedule_runs
  ALTER COLUMN scheduled_for SET NOT NULL,
  ALTER COLUMN occurrence_key SET NOT NULL,
  DROP CONSTRAINT IF EXISTS recon_schedule_runs_attempt_check,
  DROP CONSTRAINT IF EXISTS recon_schedule_runs_max_attempts_check,
  DROP CONSTRAINT IF EXISTS recon_schedule_runs_attempt_bound_check,
  ADD CONSTRAINT recon_schedule_runs_attempt_check CHECK (attempt BETWEEN 1 AND 5),
  ADD CONSTRAINT recon_schedule_runs_max_attempts_check CHECK (max_attempts BETWEEN 1 AND 5),
  ADD CONSTRAINT recon_schedule_runs_attempt_bound_check CHECK (attempt <= max_attempts);

CREATE UNIQUE INDEX IF NOT EXISTS recon_schedule_runs_occurrence_attempt_uq
  ON public.recon_schedule_runs(schedule_id, occurrence_key, attempt);
CREATE UNIQUE INDEX IF NOT EXISTS recon_schedule_runs_one_running_uq
  ON public.recon_schedule_runs(schedule_id) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS recon_schedule_runs_retry_due_idx
  ON public.recon_schedule_runs(retry_after, id)
  WHERE status = 'failed' AND superseded_by_id IS NULL;

REVOKE INSERT ON public.recon_schedule_runs FROM authenticated;
REVOKE USAGE ON SEQUENCE public.recon_schedule_runs_id_seq FROM authenticated;

CREATE OR REPLACE FUNCTION public.claim_recon_schedule_run(
  _schedule_id uuid,
  _trigger text,
  _scheduled_for timestamptz,
  _occurrence_key text,
  _attempt integer DEFAULT 1,
  _actor_user_id uuid DEFAULT NULL,
  _parent_run_id bigint DEFAULT NULL
) RETURNS TABLE(schedule_run_id bigint, disposition text, run_attempt integer, allowed_attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sched public.recon_schedules%ROWTYPE;
  existing_run public.recon_schedule_runs%ROWTYPE;
  active_run public.recon_schedule_runs%ROWTYPE;
  expired_run public.recon_schedule_runs%ROWTYPE;
  new_run public.recon_schedule_runs%ROWTYPE;
  effective_max integer;
  next_retry timestamptz;
BEGIN
  IF _trigger NOT IN ('cron', 'manual', 'watcher', 'retry') THEN
    RAISE EXCEPTION 'invalid orchestrator trigger' USING ERRCODE = '22023';
  END IF;
  IF _scheduled_for IS NULL OR NULLIF(btrim(_occurrence_key), '') IS NULL OR length(_occurrence_key) > 180 THEN
    RAISE EXCEPTION 'invalid orchestrator occurrence' USING ERRCODE = '22023';
  END IF;
  IF _attempt NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'invalid orchestrator attempt' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO sched FROM public.recon_schedules WHERE id = _schedule_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'schedule not found' USING ERRCODE = 'P0002'; END IF;

  effective_max := CASE WHEN _trigger = 'manual' THEN 1 ELSE sched.max_attempts END;
  IF _attempt > effective_max THEN
    RAISE EXCEPTION 'attempt exceeds schedule retry policy' USING ERRCODE = '22023';
  END IF;

  IF _trigger <> 'manual' AND NOT sched.enabled THEN
    IF _parent_run_id IS NOT NULL THEN
      UPDATE public.recon_schedule_runs
      SET retry_after = NULL, retry_claimed_at = now()
      WHERE id = _parent_run_id AND schedule_id = sched.id AND superseded_by_id IS NULL;
    END IF;
    INSERT INTO public.audit_log(actor_user_id, tenant_id, scope, action, resource_type, resource_id, context)
    VALUES (_actor_user_id, sched.tenant_id, 'workspace',
      CASE WHEN _actor_user_id IS NULL THEN 'system.recon.schedule.run.disabled' ELSE 'recon.schedule.run.disabled' END,
      'recon_schedule', sched.id,
      jsonb_build_object('trigger', _trigger, 'scheduled_for', _scheduled_for, 'occurrence_key', _occurrence_key));
    RETURN QUERY SELECT NULL::bigint, 'disabled'::text, _attempt, effective_max;
    RETURN;
  END IF;

  SELECT * INTO existing_run
  FROM public.recon_schedule_runs
  WHERE schedule_id = sched.id AND occurrence_key = _occurrence_key AND attempt = _attempt;
  IF FOUND THEN
    IF _parent_run_id IS NOT NULL THEN
      UPDATE public.recon_schedule_runs SET superseded_by_id = existing_run.id, retry_claimed_at = now()
      WHERE id = _parent_run_id AND schedule_id = sched.id AND superseded_by_id IS NULL;
    END IF;
    RETURN QUERY SELECT existing_run.id, 'duplicate'::text, existing_run.attempt::integer, existing_run.max_attempts::integer;
    RETURN;
  END IF;

  UPDATE public.recon_schedule_runs
  SET status = 'failed', finished_at = now(), error = 'lease_expired', lease_expires_at = NULL,
      retry_after = CASE WHEN attempt < max_attempts THEN now() + make_interval(secs => sched.retry_backoff_seconds * (2 ^ (attempt - 1))::integer) END
  WHERE schedule_id = sched.id AND status = 'running' AND lease_expires_at <= now()
  RETURNING * INTO expired_run;
  IF FOUND THEN
    INSERT INTO public.audit_log(actor_user_id, tenant_id, scope, action, resource_type, resource_id, context)
    VALUES (NULL, sched.tenant_id, 'workspace', 'system.recon.schedule.run.lease_expired', 'recon_schedule', sched.id,
      jsonb_build_object('schedule_run_id', expired_run.id, 'attempt', expired_run.attempt));
  END IF;

  SELECT * INTO active_run
  FROM public.recon_schedule_runs
  WHERE schedule_id = sched.id AND status = 'running'
  ORDER BY started_at DESC, id DESC LIMIT 1;

  IF FOUND THEN
    next_retry := CASE WHEN _attempt < effective_max
      THEN now() + make_interval(secs => sched.retry_backoff_seconds * (2 ^ (_attempt - 1))::integer)
      ELSE NULL END;
    INSERT INTO public.recon_schedule_runs(
      schedule_id, tenant_id, trigger, status, scheduled_for, occurrence_key,
      attempt, max_attempts, retry_after, actor_user_id, finished_at, error
    ) VALUES (
      sched.id, sched.tenant_id, _trigger, 'failed', _scheduled_for, _occurrence_key,
      _attempt, effective_max, next_retry, _actor_user_id, now(), 'overlap_prevented'
    ) RETURNING * INTO new_run;
    IF _parent_run_id IS NOT NULL THEN
      UPDATE public.recon_schedule_runs SET superseded_by_id = new_run.id, retry_claimed_at = now()
      WHERE id = _parent_run_id AND schedule_id = sched.id AND superseded_by_id IS NULL;
    END IF;
    IF _trigger = 'cron' THEN
      UPDATE public.recon_schedules SET last_dispatched_for = GREATEST(last_dispatched_for, _scheduled_for)
      WHERE id = sched.id;
    END IF;
    INSERT INTO public.audit_log(actor_user_id, tenant_id, scope, action, resource_type, resource_id, context)
    VALUES (_actor_user_id, sched.tenant_id, 'workspace',
      CASE WHEN _actor_user_id IS NULL THEN 'system.recon.schedule.run.overlap_prevented' ELSE 'recon.schedule.run.overlap_prevented' END,
      'recon_schedule', sched.id,
      jsonb_build_object('schedule_run_id', new_run.id, 'active_schedule_run_id', active_run.id,
        'attempt', _attempt, 'retry_after', next_retry, 'scheduled_for', _scheduled_for));
    RETURN QUERY SELECT new_run.id, 'overlap'::text, _attempt, effective_max;
    RETURN;
  END IF;

  INSERT INTO public.recon_schedule_runs(
    schedule_id, tenant_id, trigger, status, scheduled_for, occurrence_key,
    attempt, max_attempts, actor_user_id, lease_expires_at
  ) VALUES (
    sched.id, sched.tenant_id, _trigger, 'running', _scheduled_for, _occurrence_key,
    _attempt, effective_max, _actor_user_id, now() + interval '2 hours'
  ) RETURNING * INTO new_run;

  IF _parent_run_id IS NOT NULL THEN
    UPDATE public.recon_schedule_runs SET superseded_by_id = new_run.id, retry_claimed_at = now()
    WHERE id = _parent_run_id AND schedule_id = sched.id AND superseded_by_id IS NULL;
  END IF;
  IF _trigger = 'cron' THEN
    UPDATE public.recon_schedules SET last_dispatched_for = GREATEST(last_dispatched_for, _scheduled_for)
    WHERE id = sched.id;
  END IF;
  INSERT INTO public.audit_log(actor_user_id, tenant_id, scope, action, resource_type, resource_id, context)
  VALUES (_actor_user_id, sched.tenant_id, 'workspace',
    CASE WHEN _actor_user_id IS NULL THEN 'system.recon.schedule.run.started' ELSE 'recon.schedule.run.started' END,
    'recon_schedule', sched.id,
    jsonb_build_object('schedule_run_id', new_run.id, 'trigger', _trigger, 'attempt', _attempt,
      'max_attempts', effective_max, 'scheduled_for', _scheduled_for, 'occurrence_key', _occurrence_key));
  RETURN QUERY SELECT new_run.id, 'claimed'::text, _attempt, effective_max;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_recon_schedule_run(
  _schedule_run_id bigint,
  _status text,
  _recon_run_id uuid DEFAULT NULL,
  _matched_count integer DEFAULT 0,
  _exception_count integer DEFAULT 0,
  _total_rows integer DEFAULT 0,
  _error text DEFAULT NULL,
  _context jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(final_status text, next_retry_at timestamptz, run_attempt integer, allowed_attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  run_row public.recon_schedule_runs%ROWTYPE;
  sched public.recon_schedules%ROWTYPE;
  retry_at timestamptz;
  stored_error text;
BEGIN
  IF _status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'invalid terminal orchestrator status' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO run_row FROM public.recon_schedule_runs WHERE id = _schedule_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'schedule run not found' USING ERRCODE = 'P0002'; END IF;
  IF run_row.status <> 'running' THEN
    RAISE EXCEPTION 'schedule run is not active' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO sched FROM public.recon_schedules WHERE id = run_row.schedule_id FOR UPDATE;
  stored_error := CASE WHEN _status = 'failed' THEN left(COALESCE(_error, 'reconciliation_failed'), 1000) ELSE NULL END;
  retry_at := CASE WHEN _status = 'failed' AND run_row.attempt < run_row.max_attempts AND sched.enabled
    THEN now() + make_interval(secs => sched.retry_backoff_seconds * (2 ^ (run_row.attempt - 1))::integer)
    ELSE NULL END;

  UPDATE public.recon_schedule_runs
  SET status = _status, recon_run_id = _recon_run_id, finished_at = now(), lease_expires_at = NULL,
      matched_count = _matched_count, exception_count = _exception_count, total_rows = _total_rows,
      error = stored_error, retry_after = retry_at
  WHERE id = run_row.id;

  UPDATE public.recon_schedules
  SET last_run_at = now(),
      last_status = CASE WHEN retry_at IS NOT NULL THEN 'retry_scheduled' ELSE _status END,
      last_run_id = _recon_run_id,
      last_error = stored_error
  WHERE id = sched.id;

  INSERT INTO public.audit_log(actor_user_id, tenant_id, scope, action, resource_type, resource_id, context)
  VALUES (run_row.actor_user_id, run_row.tenant_id, 'workspace',
    CASE
      WHEN _status = 'completed' AND run_row.actor_user_id IS NULL THEN 'system.recon.schedule.run.complete'
      WHEN _status = 'completed' THEN 'recon.schedule.run.complete'
      WHEN retry_at IS NOT NULL AND run_row.actor_user_id IS NULL THEN 'system.recon.schedule.run.retry_scheduled'
      WHEN retry_at IS NOT NULL THEN 'recon.schedule.run.retry_scheduled'
      WHEN run_row.actor_user_id IS NULL THEN 'system.recon.schedule.run.failed'
      ELSE 'recon.schedule.run.failed'
    END,
    'recon_schedule', run_row.schedule_id,
    COALESCE(_context, '{}'::jsonb) || jsonb_build_object(
      'schedule_run_id', run_row.id, 'recon_run_id', _recon_run_id,
      'trigger', run_row.trigger, 'attempt', run_row.attempt,
      'max_attempts', run_row.max_attempts, 'retry_after', retry_at,
      'matched', _matched_count, 'exceptions', _exception_count, 'total_rows', _total_rows,
      'error', stored_error));

  RETURN QUERY SELECT _status, retry_at, run_row.attempt::integer, run_row.max_attempts::integer;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_recon_schedule_run(uuid,text,timestamptz,text,integer,uuid,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_recon_schedule_run(uuid,text,timestamptz,text,integer,uuid,bigint) TO service_role;
REVOKE ALL ON FUNCTION public.finish_recon_schedule_run(bigint,text,uuid,integer,integer,integer,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_recon_schedule_run(bigint,text,uuid,integer,integer,integer,text,jsonb) TO service_role;
