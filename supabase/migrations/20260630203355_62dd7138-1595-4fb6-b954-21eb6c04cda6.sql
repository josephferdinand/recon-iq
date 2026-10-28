
-- =========================
-- AI Governance Suite
-- =========================

CREATE TABLE public.ai_governance_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  provider text NOT NULL,
  model_id text NOT NULL,
  prompt_template text,
  prompt_hash text,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
  risk_tier text NOT NULL DEFAULT 'medium' CHECK (risk_tier IN ('low','medium','high','critical')),
  owner_id uuid,
  approved_by uuid,
  approved_at timestamptz,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name, version)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_governance_models TO authenticated;
GRANT ALL ON public.ai_governance_models TO service_role;
ALTER TABLE public.ai_governance_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aigov_models_read" ON public.ai_governance_models FOR SELECT TO authenticated
  USING (is_tenant_member(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()));
CREATE POLICY "aigov_models_write" ON public.ai_governance_models FOR ALL TO authenticated
  USING (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR is_platform_admin(auth.uid()))
  WITH CHECK (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR is_platform_admin(auth.uid()));

CREATE TABLE public.ai_governance_prompt_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  model_id uuid REFERENCES public.ai_governance_models(id) ON DELETE SET NULL,
  scope text NOT NULL,
  run_uid text,
  user_id uuid,
  prompt_hash text NOT NULL,
  response_hash text,
  confidence numeric(5,4),
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  latency_ms integer,
  outcome text,
  hitl_required boolean NOT NULL DEFAULT false,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.ai_governance_prompt_log (tenant_id, created_at DESC);
CREATE INDEX ON public.ai_governance_prompt_log (tenant_id, model_id, created_at DESC);
GRANT SELECT, INSERT ON public.ai_governance_prompt_log TO authenticated;
GRANT ALL ON public.ai_governance_prompt_log TO service_role;
ALTER TABLE public.ai_governance_prompt_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aigov_log_read" ON public.ai_governance_prompt_log FOR SELECT TO authenticated
  USING (is_tenant_member(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()));
CREATE POLICY "aigov_log_insert" ON public.ai_governance_prompt_log FOR INSERT TO authenticated
  WITH CHECK (is_tenant_member(auth.uid(), tenant_id));
-- Immutable: block UPDATE/DELETE
CREATE OR REPLACE FUNCTION public.tg_aigov_log_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN RETURN COALESCE(NEW, OLD); END IF;
  RAISE EXCEPTION 'ai_governance_prompt_log is append-only';
END $$;
CREATE TRIGGER tg_aigov_log_no_update BEFORE UPDATE OR DELETE ON public.ai_governance_prompt_log
  FOR EACH ROW EXECUTE FUNCTION public.tg_aigov_log_immutable();

CREATE TABLE public.ai_governance_confidence_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  scope text NOT NULL,
  min_confidence numeric(5,4) NOT NULL DEFAULT 0.85 CHECK (min_confidence BETWEEN 0 AND 1),
  hitl_below numeric(5,4) NOT NULL DEFAULT 0.70 CHECK (hitl_below BETWEEN 0 AND 1),
  block_below numeric(5,4) NOT NULL DEFAULT 0.50 CHECK (block_below BETWEEN 0 AND 1),
  enabled boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, scope)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_governance_confidence_thresholds TO authenticated;
GRANT ALL ON public.ai_governance_confidence_thresholds TO service_role;
ALTER TABLE public.ai_governance_confidence_thresholds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aigov_thr_read" ON public.ai_governance_confidence_thresholds FOR SELECT TO authenticated
  USING (is_tenant_member(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()));
CREATE POLICY "aigov_thr_write" ON public.ai_governance_confidence_thresholds FOR ALL TO authenticated
  USING (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR is_platform_admin(auth.uid()))
  WITH CHECK (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR is_platform_admin(auth.uid()));

CREATE TABLE public.ai_governance_hitl_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  prompt_log_id uuid REFERENCES public.ai_governance_prompt_log(id) ON DELETE SET NULL,
  model_id uuid REFERENCES public.ai_governance_models(id) ON DELETE SET NULL,
  scope text NOT NULL,
  confidence numeric(5,4),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  reviewer_id uuid,
  decision_rationale text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.ai_governance_hitl_queue (tenant_id, status, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.ai_governance_hitl_queue TO authenticated;
GRANT ALL ON public.ai_governance_hitl_queue TO service_role;
ALTER TABLE public.ai_governance_hitl_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aigov_hitl_read" ON public.ai_governance_hitl_queue FOR SELECT TO authenticated
  USING (is_tenant_member(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()));
CREATE POLICY "aigov_hitl_insert" ON public.ai_governance_hitl_queue FOR INSERT TO authenticated
  WITH CHECK (is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "aigov_hitl_update" ON public.ai_governance_hitl_queue FOR UPDATE TO authenticated
  USING (has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR is_platform_admin(auth.uid()))
  WITH CHECK (has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR is_platform_admin(auth.uid()));

CREATE TABLE public.ai_governance_drift_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES public.ai_governance_models(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  sample_count integer NOT NULL DEFAULT 0,
  avg_confidence numeric(5,4),
  p05_confidence numeric(5,4),
  hitl_rate numeric(5,4),
  reject_rate numeric(5,4),
  distribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_baseline boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.ai_governance_drift_baselines (tenant_id, model_id, created_at DESC);
GRANT SELECT, INSERT ON public.ai_governance_drift_baselines TO authenticated;
GRANT ALL ON public.ai_governance_drift_baselines TO service_role;
ALTER TABLE public.ai_governance_drift_baselines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aigov_drift_read" ON public.ai_governance_drift_baselines FOR SELECT TO authenticated
  USING (is_tenant_member(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()));
CREATE POLICY "aigov_drift_insert" ON public.ai_governance_drift_baselines FOR INSERT TO authenticated
  WITH CHECK (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR is_platform_admin(auth.uid()));

CREATE TABLE public.ai_governance_drift_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  model_id uuid REFERENCES public.ai_governance_models(id) ON DELETE CASCADE,
  baseline_id uuid REFERENCES public.ai_governance_drift_baselines(id) ON DELETE SET NULL,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  metric text NOT NULL,
  baseline_value numeric,
  observed_value numeric,
  delta_pct numeric,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.ai_governance_drift_alerts (tenant_id, status, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.ai_governance_drift_alerts TO authenticated;
GRANT ALL ON public.ai_governance_drift_alerts TO service_role;
ALTER TABLE public.ai_governance_drift_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aigov_alert_read" ON public.ai_governance_drift_alerts FOR SELECT TO authenticated
  USING (is_tenant_member(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()));
CREATE POLICY "aigov_alert_write" ON public.ai_governance_drift_alerts FOR ALL TO authenticated
  USING (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR is_platform_admin(auth.uid()))
  WITH CHECK (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR is_platform_admin(auth.uid()));

CREATE TABLE public.ai_governance_kill_switches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  scope text NOT NULL DEFAULT 'global',
  engaged boolean NOT NULL DEFAULT false,
  engaged_by uuid,
  engaged_at timestamptz,
  released_by uuid,
  released_at timestamptz,
  reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, scope)
);
GRANT SELECT, INSERT, UPDATE ON public.ai_governance_kill_switches TO authenticated;
GRANT ALL ON public.ai_governance_kill_switches TO service_role;
ALTER TABLE public.ai_governance_kill_switches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aigov_ks_read" ON public.ai_governance_kill_switches FOR SELECT TO authenticated
  USING (is_tenant_member(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()));
CREATE POLICY "aigov_ks_write" ON public.ai_governance_kill_switches FOR ALL TO authenticated
  USING (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR is_platform_admin(auth.uid()))
  WITH CHECK (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR is_platform_admin(auth.uid()));

-- =========================
-- Functions
-- =========================
CREATE OR REPLACE FUNCTION public.is_ai_kill_switch_engaged(p_tenant uuid, p_scope text DEFAULT 'global')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ai_governance_kill_switches
    WHERE tenant_id = p_tenant
      AND engaged = true
      AND scope IN ('global', p_scope)
  );
$$;
REVOKE ALL ON FUNCTION public.is_ai_kill_switch_engaged(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_ai_kill_switch_engaged(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.engage_ai_kill_switch(p_tenant uuid, p_scope text, p_reason text)
RETURNS public.ai_governance_kill_switches
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.ai_governance_kill_switches;
BEGIN
  IF NOT (has_tenant_role(auth.uid(), p_tenant, 'tenant_admin') OR is_platform_admin(auth.uid())) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  INSERT INTO public.ai_governance_kill_switches(tenant_id, scope, engaged, engaged_by, engaged_at, reason)
  VALUES (p_tenant, p_scope, true, auth.uid(), now(), p_reason)
  ON CONFLICT (tenant_id, scope) DO UPDATE
    SET engaged = true, engaged_by = auth.uid(), engaged_at = now(),
        released_by = NULL, released_at = NULL, reason = EXCLUDED.reason, updated_at = now()
  RETURNING * INTO r;

  INSERT INTO public.audit_log(tenant_id, actor_id, action, target_table, target_id, payload)
  VALUES (p_tenant, auth.uid(), 'ai.kill_switch.engaged', 'ai_governance_kill_switches', r.id,
          jsonb_build_object('scope', p_scope, 'reason', p_reason));
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.engage_ai_kill_switch(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.engage_ai_kill_switch(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.release_ai_kill_switch(p_tenant uuid, p_scope text)
RETURNS public.ai_governance_kill_switches
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.ai_governance_kill_switches;
BEGIN
  IF NOT (has_tenant_role(auth.uid(), p_tenant, 'tenant_admin') OR is_platform_admin(auth.uid())) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.ai_governance_kill_switches
    SET engaged = false, released_by = auth.uid(), released_at = now(), updated_at = now()
    WHERE tenant_id = p_tenant AND scope = p_scope
    RETURNING * INTO r;
  INSERT INTO public.audit_log(tenant_id, actor_id, action, target_table, target_id, payload)
  VALUES (p_tenant, auth.uid(), 'ai.kill_switch.released', 'ai_governance_kill_switches', r.id,
          jsonb_build_object('scope', p_scope));
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.release_ai_kill_switch(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_ai_kill_switch(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.evaluate_ai_drift(p_model_id uuid, p_window_hours int DEFAULT 24)
RETURNS public.ai_governance_drift_baselines
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid;
  v_baseline public.ai_governance_drift_baselines;
  v_observed public.ai_governance_drift_baselines;
  v_now timestamptz := now();
  v_avg numeric(5,4); v_p05 numeric(5,4); v_hitl numeric(5,4); v_n integer;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.ai_governance_models WHERE id = p_model_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'model not found'; END IF;

  SELECT count(*)::int,
         avg(confidence)::numeric(5,4),
         percentile_cont(0.05) WITHIN GROUP (ORDER BY confidence)::numeric(5,4),
         (count(*) FILTER (WHERE hitl_required) :: numeric / GREATEST(count(*),1))::numeric(5,4)
  INTO v_n, v_avg, v_p05, v_hitl
  FROM public.ai_governance_prompt_log
  WHERE model_id = p_model_id
    AND created_at >= v_now - make_interval(hours => p_window_hours);

  INSERT INTO public.ai_governance_drift_baselines(tenant_id, model_id, window_start, window_end,
    sample_count, avg_confidence, p05_confidence, hitl_rate, is_baseline)
  VALUES (v_tenant, p_model_id, v_now - make_interval(hours => p_window_hours), v_now,
    COALESCE(v_n,0), v_avg, v_p05, v_hitl, false)
  RETURNING * INTO v_observed;

  SELECT * INTO v_baseline FROM public.ai_governance_drift_baselines
    WHERE model_id = p_model_id AND is_baseline = true
    ORDER BY created_at DESC LIMIT 1;

  IF v_baseline.id IS NOT NULL AND v_baseline.avg_confidence IS NOT NULL AND v_observed.avg_confidence IS NOT NULL THEN
    IF abs(v_observed.avg_confidence - v_baseline.avg_confidence) / NULLIF(v_baseline.avg_confidence, 0) > 0.15 THEN
      INSERT INTO public.ai_governance_drift_alerts(tenant_id, model_id, baseline_id, severity, metric,
        baseline_value, observed_value, delta_pct)
      VALUES (v_tenant, p_model_id, v_baseline.id,
        CASE WHEN abs(v_observed.avg_confidence - v_baseline.avg_confidence) / v_baseline.avg_confidence > 0.30 THEN 'high' ELSE 'medium' END,
        'avg_confidence', v_baseline.avg_confidence, v_observed.avg_confidence,
        (v_observed.avg_confidence - v_baseline.avg_confidence) / v_baseline.avg_confidence * 100);
    END IF;
  END IF;

  RETURN v_observed;
END $$;
REVOKE ALL ON FUNCTION public.evaluate_ai_drift(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.evaluate_ai_drift(uuid, int) TO authenticated, service_role;
