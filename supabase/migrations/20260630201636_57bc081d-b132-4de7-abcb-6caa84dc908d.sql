
-- ============================================================
-- Continuous Security Monitoring (multi-tenant audit events)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.security_alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  description text,
  event_type_pattern text NOT NULL, -- ILIKE pattern e.g. 'rbac.abac.%'
  min_severity text NOT NULL DEFAULT 'info' CHECK (min_severity IN ('info','warning','critical')),
  window_minutes integer NOT NULL DEFAULT 15 CHECK (window_minutes BETWEEN 1 AND 1440),
  threshold integer NOT NULL DEFAULT 1 CHECK (threshold > 0),
  cooldown_minutes integer NOT NULL DEFAULT 60 CHECK (cooldown_minutes BETWEEN 1 AND 1440),
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  notify_channels jsonb NOT NULL DEFAULT '["in_app"]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  last_triggered_at timestamptz,
  last_triggered_count integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS sec_alert_rules_uniq
  ON public.security_alert_rules (COALESCE(tenant_id,'00000000-0000-0000-0000-000000000000'::uuid), code);

CREATE INDEX IF NOT EXISTS sec_alert_rules_enabled_idx
  ON public.security_alert_rules (enabled) WHERE enabled;

GRANT SELECT ON public.security_alert_rules TO authenticated;
GRANT ALL ON public.security_alert_rules TO service_role;
ALTER TABLE public.security_alert_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY sar_read ON public.security_alert_rules
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR (tenant_id IS NOT NULL AND private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
  );

CREATE POLICY sar_platform_write ON public.security_alert_rules
  FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.security_alert_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.security_alert_rules(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  fired_at timestamptz NOT NULL DEFAULT now(),
  event_count integer NOT NULL,
  window_minutes integer NOT NULL,
  severity text NOT NULL,
  sample_event_ids bigint[] NOT NULL DEFAULT '{}',
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at timestamptz,
  acknowledged_by uuid
);

CREATE INDEX IF NOT EXISTS sai_tenant_fired_idx
  ON public.security_alert_incidents (tenant_id, fired_at DESC);
CREATE INDEX IF NOT EXISTS sai_rule_fired_idx
  ON public.security_alert_incidents (rule_id, fired_at DESC);

GRANT SELECT, UPDATE ON public.security_alert_incidents TO authenticated;
GRANT ALL ON public.security_alert_incidents TO service_role;
ALTER TABLE public.security_alert_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY sai_read ON public.security_alert_incidents
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR (tenant_id IS NOT NULL AND private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
  );

-- Tenant admins can acknowledge their own incidents; platform admins any.
CREATE POLICY sai_ack ON public.security_alert_incidents
  FOR UPDATE TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR (tenant_id IS NOT NULL AND private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
  )
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR (tenant_id IS NOT NULL AND private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
  );

-- ---------------------------------------------------------------
-- Evaluator: scans security_events vs enabled rules, writes incidents,
-- creates in-app notifications for tenant admins on the affected tenant.
CREATE OR REPLACE FUNCTION public.evaluate_security_alerts()
RETURNS TABLE(rule_id uuid, tenant_id uuid, event_count integer, fired boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_count integer;
  v_samples bigint[];
  v_severity_filter text[];
  v_min_ts timestamptz;
  v_incident_id uuid;
BEGIN
  FOR r IN
    SELECT * FROM public.security_alert_rules WHERE enabled = true
  LOOP
    -- Respect cooldown
    IF r.last_triggered_at IS NOT NULL
       AND r.last_triggered_at > now() - (r.cooldown_minutes || ' minutes')::interval
    THEN
      RETURN QUERY SELECT r.id, r.tenant_id, 0, false;
      CONTINUE;
    END IF;

    v_min_ts := now() - (r.window_minutes || ' minutes')::interval;
    v_severity_filter := CASE r.min_severity
      WHEN 'info' THEN ARRAY['info','warning','critical']
      WHEN 'warning' THEN ARRAY['warning','critical']
      ELSE ARRAY['critical']
    END;

    -- Per-tenant rule (tenant_id NOT NULL): scope to that tenant only.
    -- Platform-wide rule (tenant_id IS NULL): evaluate per-tenant of the matching events.
    IF r.tenant_id IS NOT NULL THEN
      SELECT count(*)::int,
             COALESCE(array_agg(id ORDER BY occurred_at DESC) FILTER (WHERE id IS NOT NULL), '{}')
        INTO v_count, v_samples
      FROM (
        SELECT id, occurred_at
        FROM public.security_events
        WHERE tenant_id = r.tenant_id
          AND event_type ILIKE r.event_type_pattern
          AND severity = ANY(v_severity_filter)
          AND occurred_at >= v_min_ts
        ORDER BY occurred_at DESC
        LIMIT 25
      ) s;

      IF v_count >= r.threshold THEN
        INSERT INTO public.security_alert_incidents
          (rule_id, tenant_id, event_count, window_minutes, severity, sample_event_ids, context)
        VALUES
          (r.id, r.tenant_id, v_count, r.window_minutes, r.severity, v_samples,
           jsonb_build_object('rule_code', r.code, 'pattern', r.event_type_pattern))
        RETURNING id INTO v_incident_id;

        UPDATE public.security_alert_rules
           SET last_triggered_at = now(), last_triggered_count = v_count
         WHERE id = r.id;

        -- Notify tenant admins (best-effort; ignore if notifications table is unavailable)
        BEGIN
          INSERT INTO public.notifications (user_id, tenant_id, kind, title, body, link_to, severity, context)
          SELECT tm.user_id, r.tenant_id, 'security_alert',
                 'Security alert: ' || r.code,
                 v_count || ' matching events in last ' || r.window_minutes || 'min',
                 '/security-audit',
                 r.severity,
                 jsonb_build_object('incident_id', v_incident_id, 'rule_id', r.id)
          FROM public.tenant_members tm
          WHERE tm.tenant_id = r.tenant_id
            AND tm.active = true
            AND tm.role IN ('tenant_admin','tenant_owner');
        EXCEPTION WHEN OTHERS THEN NULL;
        END;

        RETURN QUERY SELECT r.id, r.tenant_id, v_count, true;
      ELSE
        RETURN QUERY SELECT r.id, r.tenant_id, v_count, false;
      END IF;

    ELSE
      -- Platform-wide rule: group by tenant
      FOR v_count, v_samples, v_incident_id IN
        SELECT count(*)::int AS c,
               COALESCE(array_agg(s.id ORDER BY s.occurred_at DESC), '{}'::bigint[]) AS samples,
               s.tenant_id
        FROM public.security_events s
        WHERE s.event_type ILIKE r.event_type_pattern
          AND s.severity = ANY(v_severity_filter)
          AND s.occurred_at >= v_min_ts
        GROUP BY s.tenant_id
        HAVING count(*) >= r.threshold
      LOOP
        -- v_incident_id reused as tenant_id loop var; rebind:
        NULL;
      END LOOP;

      -- Re-run cleanly with proper loop variables:
      FOR r IN
        SELECT r.id AS rid, r.code, r.event_type_pattern, r.severity, r.window_minutes, r.threshold, r.cooldown_minutes,
               grp.tenant_id AS t_id, grp.c AS cnt, grp.samples
        FROM public.security_alert_rules r
        CROSS JOIN LATERAL (
          SELECT s.tenant_id,
                 count(*)::int AS c,
                 COALESCE(array_agg(s.id ORDER BY s.occurred_at DESC), '{}'::bigint[]) AS samples
          FROM public.security_events s
          WHERE s.event_type ILIKE r.event_type_pattern
            AND s.severity = ANY(v_severity_filter)
            AND s.occurred_at >= now() - (r.window_minutes || ' minutes')::interval
          GROUP BY s.tenant_id
          HAVING count(*) >= r.threshold
        ) grp
        WHERE r.enabled = true AND r.tenant_id IS NULL
          AND (r.last_triggered_at IS NULL OR r.last_triggered_at <= now() - (r.cooldown_minutes || ' minutes')::interval)
      LOOP
        INSERT INTO public.security_alert_incidents
          (rule_id, tenant_id, event_count, window_minutes, severity, sample_event_ids, context)
        VALUES
          (r.rid, r.t_id, r.cnt, r.window_minutes, r.severity, r.samples,
           jsonb_build_object('rule_code', r.code, 'pattern', r.event_type_pattern, 'platform_rule', true))
        RETURNING id INTO v_incident_id;

        UPDATE public.security_alert_rules
           SET last_triggered_at = now(), last_triggered_count = r.cnt
         WHERE id = r.rid;

        BEGIN
          INSERT INTO public.notifications (user_id, tenant_id, kind, title, body, link_to, severity, context)
          SELECT tm.user_id, r.t_id, 'security_alert',
                 'Security alert: ' || r.code,
                 r.cnt || ' matching events in last ' || r.window_minutes || 'min',
                 '/security-audit',
                 r.severity,
                 jsonb_build_object('incident_id', v_incident_id, 'rule_id', r.rid)
          FROM public.tenant_members tm
          WHERE tm.tenant_id = r.t_id
            AND tm.active = true
            AND tm.role IN ('tenant_admin','tenant_owner');
        EXCEPTION WHEN OTHERS THEN NULL;
        END;

        RETURN QUERY SELECT r.rid, r.t_id, r.cnt, true;
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.evaluate_security_alerts() FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_security_alerts() TO service_role;

-- ---------------------------------------------------------------
-- Seed default platform-wide rules covering Phase 6–8 critical flows.
-- Idempotent via UNIQUE (COALESCE(tenant_id,...), code).
INSERT INTO public.security_alert_rules
  (tenant_id, code, description, event_type_pattern, min_severity, window_minutes, threshold, cooldown_minutes, severity)
VALUES
  (NULL, 'abac_predicate_write', 'ABAC predicate created/changed (Phase 6)',          'rbac.abac.%',           'info',    15, 1, 30, 'warning'),
  (NULL, 'master_data_write',    'Golden-source master data mutated (Phase 6)',       'master_data.%',         'info',    60, 5, 60, 'warning'),
  (NULL, 'residency_change',     'Tenant data residency changed',                     'residency.%',           'info',    60, 1, 30, 'critical'),
  (NULL, 'ai_residency_block',   'AI request blocked by residency policy',            'ai.residency_block',    'warning', 15, 1, 15, 'critical'),
  (NULL, 'byok_rotate',          'BYOK / CMEK key rotated or registered',             'byok.%',                'info',    60, 1, 60, 'warning'),
  (NULL, 'break_glass_granted',  'Break-glass access granted',                        'break_glass.%',         'info',    15, 1, 15, 'critical'),
  (NULL, 'chaos_drill_started',  'Chaos drill scheduled or executed (Phase 8)',       'chaos_drill.%',         'info',    60, 1, 60, 'info'),
  (NULL, 'silo_assignment',      'Tenant silo assignment requested (Phase 8)',        'silo.%',                'info',    60, 1, 60, 'warning'),
  (NULL, 'github_sync_change',   'GitHub sync change request raised',                 'github_sync.%',         'info',    60, 1, 30, 'warning'),
  (NULL, 'red_team_scan',        'Red-team scan started (Phase 7)',                   'red_team.%',            'info',    60, 1, 60, 'warning'),
  (NULL, 'cron_unauthorized',    'Unauthorized cron endpoint hit',                    'cron.unauthorized',     'warning', 10, 3, 30, 'critical'),
  (NULL, 'auth_failure_spike',   'Burst of failed sign-ins (potential brute force)',  'auth.login_failed',     'info',    10, 10, 30, 'critical'),
  (NULL, 'step_up_failure',      'Step-up auth challenges failing',                   'step_up.failed',        'warning', 15, 3, 30, 'warning'),
  (NULL, 'rate_limit_p99_high',  'Rate-limit bucket p99 elevated',                    'rate_limit.p99_high',   'warning', 60, 1, 60, 'warning')
ON CONFLICT (COALESCE(tenant_id,'00000000-0000-0000-0000-000000000000'::uuid), code) DO NOTHING;

-- ---------------------------------------------------------------
-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_security_alert_rules_updated()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_sar_updated ON public.security_alert_rules;
CREATE TRIGGER trg_sar_updated
  BEFORE UPDATE ON public.security_alert_rules
  FOR EACH ROW EXECUTE FUNCTION public.tg_security_alert_rules_updated();
