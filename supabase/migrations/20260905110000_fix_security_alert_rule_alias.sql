-- Avoid ambiguity between the PL/pgSQL record `r` and the nested SQL alias.

DO $repair$
DECLARE
  original text;
  fixed text;
BEGIN
  original := pg_get_functiondef('public.evaluate_security_alerts()'::regprocedure);
  fixed := replace(
    original,
    'FOR r IN
        SELECT r.id AS rid, r.code, r.event_type_pattern, r.severity, r.window_minutes, r.threshold, r.cooldown_minutes,
               grp.tenant_id AS t_id, grp.c AS cnt, grp.samples
        FROM public.security_alert_rules r
        CROSS JOIN LATERAL (
          SELECT s.tenant_id,
                 count(*)::int AS c,
                 COALESCE(array_agg(s.id ORDER BY s.occurred_at DESC), ''{}''::bigint[]) AS samples
          FROM public.security_events s
          WHERE s.event_type ILIKE r.event_type_pattern
            AND s.severity = ANY(v_severity_filter)
            AND s.occurred_at >= now() - (r.window_minutes || '' minutes'')::interval
          GROUP BY s.tenant_id
          HAVING count(*) >= r.threshold
        ) grp
        WHERE r.enabled = true AND r.tenant_id IS NULL
          AND (r.last_triggered_at IS NULL OR r.last_triggered_at <= now() - (r.cooldown_minutes || '' minutes'')::interval)
      LOOP',
    'FOR r IN
        SELECT alert_rule.id AS rid, alert_rule.code, alert_rule.event_type_pattern, alert_rule.severity,
               alert_rule.window_minutes, alert_rule.threshold, alert_rule.cooldown_minutes,
               grp.tenant_id AS t_id, grp.c AS cnt, grp.samples
        FROM public.security_alert_rules alert_rule
        CROSS JOIN LATERAL (
          SELECT s.tenant_id,
                 count(*)::int AS c,
                 COALESCE(array_agg(s.id ORDER BY s.occurred_at DESC), ''{}''::bigint[]) AS samples
          FROM public.security_events s
          WHERE s.event_type ILIKE alert_rule.event_type_pattern
            AND s.severity = ANY(v_severity_filter)
            AND s.occurred_at >= now() - (alert_rule.window_minutes || '' minutes'')::interval
          GROUP BY s.tenant_id
          HAVING count(*) >= alert_rule.threshold
        ) grp
        WHERE alert_rule.enabled = true AND alert_rule.tenant_id IS NULL
          AND (alert_rule.last_triggered_at IS NULL
            OR alert_rule.last_triggered_at <= now() - (alert_rule.cooldown_minutes || '' minutes'')::interval)
      LOOP'
  );
  IF fixed = original THEN
    RAISE EXCEPTION 'evaluate_security_alerts rule-alias repair anchor missing';
  END IF;
  EXECUTE fixed;
END
$repair$;
