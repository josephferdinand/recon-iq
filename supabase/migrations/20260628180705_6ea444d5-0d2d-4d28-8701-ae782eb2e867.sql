
-- Worker health monitoring + circuit breakers + audited retry transitions
CREATE TYPE public.worker_breaker_state AS ENUM ('closed','half_open','open');
CREATE TYPE public.worker_breaker_scope AS ENUM ('pipeline','data_source');

CREATE TABLE public.worker_circuit_breakers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  scope public.worker_breaker_scope NOT NULL,
  -- pipeline_id for scope='pipeline', data_source_id for scope='data_source'
  target_id uuid NOT NULL,
  state public.worker_breaker_state NOT NULL DEFAULT 'closed',
  consecutive_failures int NOT NULL DEFAULT 0,
  failure_threshold int NOT NULL DEFAULT 5,
  cooldown_seconds int NOT NULL DEFAULT 300,
  opened_at timestamptz,
  next_probe_at timestamptz,
  last_failure_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, scope, target_id)
);
GRANT SELECT ON public.worker_circuit_breakers TO authenticated;
GRANT ALL    ON public.worker_circuit_breakers TO service_role;
ALTER TABLE public.worker_circuit_breakers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant members view breakers" ON public.worker_circuit_breakers
  FOR SELECT TO authenticated USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "service role manages breakers" ON public.worker_circuit_breakers
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_wcb_tenant_state ON public.worker_circuit_breakers (tenant_id, state);

-- Per-attempt retry log with audited transitions
CREATE TABLE public.worker_retry_attempts (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  pipeline_id uuid,
  data_source_id uuid,
  run_id uuid,
  step text NOT NULL,
  attempt int NOT NULL,
  max_attempts int NOT NULL,
  status text NOT NULL CHECK (status IN ('success','retry_scheduled','retry_exhausted','breaker_open','breaker_half_open_probe','breaker_closed')),
  error text,
  backoff_seconds int,
  breaker_state public.worker_breaker_state,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.worker_retry_attempts TO authenticated;
GRANT ALL    ON public.worker_retry_attempts TO service_role;
ALTER TABLE public.worker_retry_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant members view retries" ON public.worker_retry_attempts
  FOR SELECT TO authenticated USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "service role manages retries" ON public.worker_retry_attempts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX idx_wra_tenant_time ON public.worker_retry_attempts (tenant_id, attempted_at DESC);
CREATE INDEX idx_wra_pipeline ON public.worker_retry_attempts (pipeline_id, attempted_at DESC);

-- Worker health heartbeat
CREATE TABLE public.worker_health_heartbeats (
  worker_id text PRIMARY KEY,
  worker_kind text NOT NULL,
  region text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  in_flight int NOT NULL DEFAULT 0,
  total_processed bigint NOT NULL DEFAULT 0,
  total_failed bigint NOT NULL DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT ON public.worker_health_heartbeats TO authenticated;
GRANT ALL    ON public.worker_health_heartbeats TO service_role;
ALTER TABLE public.worker_health_heartbeats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "platform admins view heartbeats" ON public.worker_health_heartbeats
  FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));
CREATE POLICY "service role manages heartbeats" ON public.worker_health_heartbeats
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Atomic record-failure: increments breaker, opens if threshold breached, writes audit_log
CREATE OR REPLACE FUNCTION public.worker_record_failure(
  _tenant uuid,
  _scope public.worker_breaker_scope,
  _target uuid,
  _step text,
  _run_id uuid,
  _attempt int,
  _max_attempts int,
  _error text,
  _backoff_seconds int
) RETURNS TABLE(breaker_state public.worker_breaker_state, action text, next_probe_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row public.worker_circuit_breakers%ROWTYPE;
  v_action text;
  v_new_state public.worker_breaker_state;
BEGIN
  INSERT INTO public.worker_circuit_breakers (tenant_id, scope, target_id, last_failure_at, last_error, consecutive_failures)
  VALUES (_tenant, _scope, _target, now(), _error, 1)
  ON CONFLICT (tenant_id, scope, target_id) DO UPDATE
    SET consecutive_failures = public.worker_circuit_breakers.consecutive_failures + 1,
        last_failure_at = now(),
        last_error = _error,
        updated_at = now()
  RETURNING * INTO v_row;

  v_new_state := v_row.state;
  v_action := CASE WHEN _attempt < _max_attempts THEN 'retry_scheduled' ELSE 'retry_exhausted' END;

  IF v_row.consecutive_failures >= v_row.failure_threshold AND v_row.state <> 'open' THEN
    UPDATE public.worker_circuit_breakers
       SET state = 'open',
           opened_at = now(),
           next_probe_at = now() + make_interval(secs => v_row.cooldown_seconds),
           updated_at = now()
     WHERE id = v_row.id
    RETURNING * INTO v_row;
    v_new_state := 'open';
    v_action := 'breaker_open';

    INSERT INTO public.audit_log(actor_user_id, tenant_id, scope, action, resource_type, resource_id, context)
    VALUES (NULL, _tenant, 'tenant', 'worker.breaker.open', _scope::text, _target::text,
            jsonb_build_object('consecutive_failures', v_row.consecutive_failures,
                               'threshold', v_row.failure_threshold,
                               'cooldown_seconds', v_row.cooldown_seconds,
                               'last_error', _error,
                               'step', _step,
                               'run_id', _run_id));
  END IF;

  INSERT INTO public.worker_retry_attempts(
    tenant_id, pipeline_id, data_source_id, run_id, step, attempt, max_attempts,
    status, error, backoff_seconds, breaker_state
  ) VALUES (
    _tenant,
    CASE WHEN _scope = 'pipeline' THEN _target ELSE NULL END,
    CASE WHEN _scope = 'data_source' THEN _target ELSE NULL END,
    _run_id, _step, _attempt, _max_attempts,
    v_action, _error, _backoff_seconds, v_new_state
  );

  INSERT INTO public.audit_log(actor_user_id, tenant_id, scope, action, resource_type, resource_id, context)
  VALUES (NULL, _tenant, 'tenant', 'worker.step.retry', _scope::text, _target::text,
          jsonb_build_object('step', _step, 'attempt', _attempt, 'max_attempts', _max_attempts,
                             'backoff_seconds', _backoff_seconds, 'breaker_state', v_new_state,
                             'action', v_action, 'error', _error, 'run_id', _run_id));

  RETURN QUERY SELECT v_new_state, v_action, v_row.next_probe_at;
END $$;
REVOKE EXECUTE ON FUNCTION public.worker_record_failure(uuid,public.worker_breaker_scope,uuid,text,uuid,int,int,text,int) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.worker_record_failure(uuid,public.worker_breaker_scope,uuid,text,uuid,int,int,text,int) TO service_role;

-- Atomic record-success: closes/half-opens breaker, audits transition
CREATE OR REPLACE FUNCTION public.worker_record_success(
  _tenant uuid,
  _scope public.worker_breaker_scope,
  _target uuid,
  _step text,
  _run_id uuid,
  _attempt int
) RETURNS public.worker_breaker_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row public.worker_circuit_breakers%ROWTYPE; v_prev public.worker_breaker_state;
BEGIN
  INSERT INTO public.worker_circuit_breakers (tenant_id, scope, target_id, last_success_at, consecutive_failures, state)
  VALUES (_tenant, _scope, _target, now(), 0, 'closed')
  ON CONFLICT (tenant_id, scope, target_id) DO UPDATE
    SET last_success_at = now(),
        consecutive_failures = 0,
        state = 'closed',
        opened_at = NULL,
        next_probe_at = NULL,
        updated_at = now()
  RETURNING * INTO v_row;

  GET DIAGNOSTICS v_prev = ROW_COUNT;

  INSERT INTO public.worker_retry_attempts(
    tenant_id, pipeline_id, data_source_id, run_id, step, attempt, max_attempts,
    status, breaker_state
  ) VALUES (
    _tenant,
    CASE WHEN _scope = 'pipeline' THEN _target ELSE NULL END,
    CASE WHEN _scope = 'data_source' THEN _target ELSE NULL END,
    _run_id, _step, _attempt, _attempt, 'success', 'closed'
  );

  INSERT INTO public.audit_log(actor_user_id, tenant_id, scope, action, resource_type, resource_id, context)
  VALUES (NULL, _tenant, 'tenant', 'worker.step.success', _scope::text, _target::text,
          jsonb_build_object('step', _step, 'attempt', _attempt, 'run_id', _run_id, 'breaker_state', 'closed'));

  RETURN 'closed'::public.worker_breaker_state;
END $$;
REVOKE EXECUTE ON FUNCTION public.worker_record_success(uuid,public.worker_breaker_scope,uuid,text,uuid,int) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.worker_record_success(uuid,public.worker_breaker_scope,uuid,text,uuid,int) TO service_role;

-- Check breaker before executing a step. Half-opens on probe window.
CREATE OR REPLACE FUNCTION public.worker_check_breaker(
  _tenant uuid,
  _scope public.worker_breaker_scope,
  _target uuid
) RETURNS TABLE(allow boolean, state public.worker_breaker_state, retry_after_seconds int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row public.worker_circuit_breakers%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.worker_circuit_breakers
   WHERE tenant_id = _tenant AND scope = _scope AND target_id = _target FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT true, 'closed'::public.worker_breaker_state, 0; RETURN; END IF;
  IF v_row.state = 'closed' THEN RETURN QUERY SELECT true, v_row.state, 0; RETURN; END IF;
  IF v_row.state = 'open' AND v_row.next_probe_at IS NOT NULL AND now() >= v_row.next_probe_at THEN
    UPDATE public.worker_circuit_breakers SET state = 'half_open', updated_at = now() WHERE id = v_row.id;
    INSERT INTO public.audit_log(actor_user_id, tenant_id, scope, action, resource_type, resource_id, context)
    VALUES (NULL, _tenant, 'tenant', 'worker.breaker.half_open', _scope::text, _target::text, '{}'::jsonb);
    RETURN QUERY SELECT true, 'half_open'::public.worker_breaker_state, 0; RETURN;
  END IF;
  IF v_row.state = 'open' THEN
    RETURN QUERY SELECT false, v_row.state,
      GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(v_row.next_probe_at, now()) - now()))::int);
    RETURN;
  END IF;
  RETURN QUERY SELECT true, v_row.state, 0;
END $$;
REVOKE EXECUTE ON FUNCTION public.worker_check_breaker(uuid,public.worker_breaker_scope,uuid) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.worker_check_breaker(uuid,public.worker_breaker_scope,uuid) TO service_role;

-- Manual reset (tenant admin or platform admin)
CREATE OR REPLACE FUNCTION public.worker_breaker_reset(_breaker_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.worker_circuit_breakers%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.worker_circuit_breakers WHERE id = _breaker_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT (public.has_tenant_role(auth.uid(), v_row.tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid())) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.worker_circuit_breakers
     SET state = 'closed', consecutive_failures = 0, opened_at = NULL,
         next_probe_at = NULL, updated_at = now()
   WHERE id = _breaker_id;
  INSERT INTO public.audit_log(actor_user_id, tenant_id, scope, action, resource_type, resource_id, context)
  VALUES (auth.uid(), v_row.tenant_id, 'tenant', 'worker.breaker.manual_reset',
          v_row.scope::text, v_row.target_id::text, '{}'::jsonb);
  RETURN true;
END $$;
REVOKE EXECUTE ON FUNCTION public.worker_breaker_reset(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.worker_breaker_reset(uuid) TO authenticated, service_role;
