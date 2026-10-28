-- Fix evaluate_rls_alerts() failing every five minutes with SQLSTATE 42702.
--
-- The function returns an output column named tenant_id. In PL/pgSQL that
-- output column is also a variable, so every unqualified table reference to
-- tenant_id is ambiguous. Qualify all table columns while preserving the
-- existing alert thresholds, cooldown, notification, and audit behavior.

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
  SELECT t.*
    INTO v_default
    FROM public.rls_alert_thresholds AS t
   WHERE t.tenant_id IS NULL
   LIMIT 1;

  FOR r IN
    SELECT DISTINCT se.tenant_id
      FROM public.security_events AS se
     WHERE se.event_type = 'rls_denied'
       AND se.tenant_id IS NOT NULL
       AND se.occurred_at > now() - interval '1 day'
  LOOP
    -- Resolve effective threshold config (tenant override -> platform default).
    SELECT t.window_minutes,
           t.threshold,
           t.cooldown_minutes,
           t.severity,
           t.resource_filter,
           t.enabled
      INTO v_window,
           v_threshold,
           v_cooldown,
           v_severity,
           v_resource,
           alerted
      FROM public.rls_alert_thresholds AS t
     WHERE t.tenant_id = r.tenant_id
     LIMIT 1;

    IF NOT FOUND THEN
      v_window := v_default.window_minutes;
      v_threshold := v_default.threshold;
      v_cooldown := v_default.cooldown_minutes;
      v_severity := v_default.severity;
      v_resource := v_default.resource_filter;
      alerted := v_default.enabled;
    END IF;

    IF alerted IS DISTINCT FROM true THEN
      CONTINUE;
    END IF;

    -- Respect the tenant threshold cooldown, or the platform default when no
    -- tenant override exists.
    PERFORM 1
      FROM public.rls_alert_thresholds AS t
     WHERE (
             t.tenant_id = r.tenant_id
             OR (
               t.tenant_id IS NULL
               AND NOT EXISTS (
                 SELECT 1
                   FROM public.rls_alert_thresholds AS tenant_threshold
                  WHERE tenant_threshold.tenant_id = r.tenant_id
               )
             )
           )
       AND t.last_triggered_at IS NOT NULL
       AND t.last_triggered_at > now() - make_interval(mins => v_cooldown);
    IF FOUND THEN
      CONTINUE;
    END IF;

    SELECT count(*)
      INTO v_count
      FROM public.security_events AS se
     WHERE se.event_type = 'rls_denied'
       AND se.tenant_id = r.tenant_id
       AND se.occurred_at > now() - make_interval(mins => v_window)
       AND (v_resource IS NULL OR (se.context ->> 'resource') = v_resource);

    tenant_id := r.tenant_id;
    denial_count := v_count;
    threshold := v_threshold;
    alerted := (v_count >= v_threshold);

    IF alerted THEN
      INSERT INTO public.notifications (
        user_id,
        tenant_id,
        kind,
        title,
        body,
        link_to,
        severity,
        context
      )
      SELECT pr.user_id,
             r.tenant_id,
             'rls_denial_spike',
             'RLS denial spike detected',
             format(
               '%s RLS denials in the last %s min (threshold %s).',
               v_count,
               v_window,
               v_threshold
             ),
             '/platform-admin/security/residency',
             v_severity,
             jsonb_build_object(
               'tenant_id', r.tenant_id,
               'count', v_count,
               'threshold', v_threshold,
               'window_minutes', v_window,
               'resource_filter', v_resource
             )
        FROM public.platform_roles AS pr
       WHERE pr.role = 'platform_admin';
      GET DIAGNOSTICS v_notified = ROW_COUNT;

      INSERT INTO public.security_events (
        tenant_id,
        event_type,
        severity,
        context
      )
      VALUES (
        r.tenant_id,
        'rls_denial_alert',
        v_severity,
        jsonb_build_object(
          'count', v_count,
          'threshold', v_threshold,
          'window_minutes', v_window,
          'notified_admins', v_notified
        )
      );

      UPDATE public.rls_alert_thresholds AS t
         SET last_triggered_at = now(),
             last_triggered_count = v_count
       WHERE t.tenant_id = r.tenant_id;
      IF NOT FOUND THEN
        UPDATE public.rls_alert_thresholds AS t
           SET last_triggered_at = now(),
               last_triggered_count = v_count
         WHERE t.tenant_id IS NULL;
      END IF;
    END IF;

    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.evaluate_rls_alerts()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_rls_alerts() TO service_role;
