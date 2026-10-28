
-- 1) Thresholds table (tenant-scoped; NULL tenant = platform-wide default)
CREATE TABLE public.rls_alert_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  window_minutes int NOT NULL DEFAULT 15 CHECK (window_minutes BETWEEN 1 AND 1440),
  threshold int NOT NULL DEFAULT 25 CHECK (threshold > 0),
  cooldown_minutes int NOT NULL DEFAULT 60 CHECK (cooldown_minutes BETWEEN 1 AND 1440),
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  enabled boolean NOT NULL DEFAULT true,
  resource_filter text NULL,
  last_triggered_at timestamptz NULL,
  last_triggered_count int NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_by uuid NULL
);
CREATE UNIQUE INDEX rls_alert_thresholds_tenant_uniq
  ON public.rls_alert_thresholds (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rls_alert_thresholds TO authenticated;
GRANT ALL ON public.rls_alert_thresholds TO service_role;
ALTER TABLE public.rls_alert_thresholds ENABLE ROW LEVEL SECURITY;

-- Only platform admins manage thresholds; tenant admins may view their own row.
CREATE POLICY rls_thresh_platform_all ON public.rls_alert_thresholds
  FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE POLICY rls_thresh_tenant_read ON public.rls_alert_thresholds
  FOR SELECT TO authenticated
  USING (tenant_id IS NOT NULL AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));

CREATE TRIGGER tg_rls_thresh_updated_at
  BEFORE UPDATE ON public.rls_alert_thresholds
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Seed a single platform-wide default row
INSERT INTO public.rls_alert_thresholds (tenant_id) VALUES (NULL)
  ON CONFLICT DO NOTHING;

-- 2) Evaluation function: scan recent rls_denied events, compare to threshold,
--    honour cooldown, then notify every platform_admin and emit a security_events row.
CREATE OR REPLACE FUNCTION public.evaluate_rls_alerts()
RETURNS TABLE(tenant_id uuid, denial_count int, threshold int, alerted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_default record;
  v_threshold int;
  v_window int;
  v_cooldown int;
  v_severity text;
  v_resource text;
  v_count int;
  v_notified int;
BEGIN
  SELECT * INTO v_default FROM public.rls_alert_thresholds WHERE tenant_id IS NULL LIMIT 1;

  FOR r IN
    SELECT DISTINCT se.tenant_id
    FROM public.security_events se
    WHERE se.event_type = 'rls_denied'
      AND se.tenant_id IS NOT NULL
      AND se.occurred_at > now() - interval '1 day'
  LOOP
    -- Resolve effective threshold config (tenant override → platform default)
    SELECT t.window_minutes, t.threshold, t.cooldown_minutes, t.severity, t.resource_filter, t.enabled
      INTO v_window, v_threshold, v_cooldown, v_severity, v_resource, alerted
    FROM public.rls_alert_thresholds t
    WHERE t.tenant_id = r.tenant_id
    LIMIT 1;

    IF NOT FOUND THEN
      v_window   := v_default.window_minutes;
      v_threshold:= v_default.threshold;
      v_cooldown := v_default.cooldown_minutes;
      v_severity := v_default.severity;
      v_resource := v_default.resource_filter;
      alerted    := v_default.enabled;
    END IF;

    IF alerted IS DISTINCT FROM true THEN
      CONTINUE;
    END IF;

    -- Cooldown check
    PERFORM 1 FROM public.rls_alert_thresholds
      WHERE (tenant_id = r.tenant_id OR (tenant_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM public.rls_alert_thresholds WHERE tenant_id = r.tenant_id)))
        AND last_triggered_at IS NOT NULL
        AND last_triggered_at > now() - make_interval(mins => v_cooldown);
    IF FOUND THEN CONTINUE; END IF;

    SELECT count(*) INTO v_count
    FROM public.security_events
    WHERE event_type = 'rls_denied'
      AND tenant_id = r.tenant_id
      AND occurred_at > now() - make_interval(mins => v_window)
      AND (v_resource IS NULL OR (context->>'resource') = v_resource);

    tenant_id    := r.tenant_id;
    denial_count := v_count;
    threshold    := v_threshold;
    alerted      := (v_count >= v_threshold);

    IF alerted THEN
      -- Notify each platform admin
      INSERT INTO public.notifications (user_id, tenant_id, kind, title, body, link_to, severity, context)
      SELECT pr.user_id, r.tenant_id, 'rls_denial_spike',
             'RLS denial spike detected',
             format('%s RLS denials in the last %s min (threshold %s).',
                    v_count, v_window, v_threshold),
             '/platform-admin/security/residency',
             v_severity,
             jsonb_build_object('tenant_id', r.tenant_id, 'count', v_count,
                                'threshold', v_threshold, 'window_minutes', v_window,
                                'resource_filter', v_resource)
      FROM public.platform_roles pr
      WHERE pr.role = 'platform_admin';
      GET DIAGNOSTICS v_notified = ROW_COUNT;

      INSERT INTO public.security_events (tenant_id, event_type, severity, context)
      VALUES (r.tenant_id, 'rls_denial_alert', v_severity,
              jsonb_build_object('count', v_count, 'threshold', v_threshold,
                                 'window_minutes', v_window,
                                 'notified_admins', v_notified));

      -- Stamp the matched threshold row (tenant override if present, else default)
      UPDATE public.rls_alert_thresholds
         SET last_triggered_at = now(), last_triggered_count = v_count
       WHERE tenant_id = r.tenant_id;
      IF NOT FOUND THEN
        UPDATE public.rls_alert_thresholds
           SET last_triggered_at = now(), last_triggered_count = v_count
         WHERE tenant_id IS NULL;
      END IF;
    END IF;

    RETURN NEXT;
  END LOOP;
  RETURN;
END $$;

REVOKE EXECUTE ON FUNCTION public.evaluate_rls_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_rls_alerts() TO service_role;

-- 3) Schedule every 5 minutes
DO $$
BEGIN
  PERFORM cron.unschedule('evaluate-rls-alerts');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'evaluate-rls-alerts',
  '*/5 * * * *',
  $$ SELECT public.evaluate_rls_alerts(); $$
);
