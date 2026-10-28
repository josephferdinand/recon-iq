-- Tenant-scoped Exception dashboard aggregates.
--
-- Semantics:
--   * _days bounds only the UTC creation-cohort trend (7, 30 or 90 days).
--   * totals, severity and status describe the tenant's full exception population.
--   * ageing and reconciliation contributors describe the current open backlog.
--   * high_priority means a currently open P1/P2 exception; unassigned also
--     counts only current open exceptions.
--   * closed means lifecycle_state IN ('resolved','written_off') OR the legacy
--     status IN ('resolved','wont_fix'). updated_at is never treated as a
--     resolution timestamp, and the dashboard does not invent SLA/exposure data.
--   * the 31–90 bucket includes age day 90; 90+ is strictly older than 90 days.
--   * the function is VOLATILE because every authorized call consumes one
--     fixed, database-enforced per-actor/per-tenant rate-limit token.

DO $$
BEGIN
  IF to_regclass('public.recon_exceptions') IS NULL
     OR to_regclass('public.recon_runs') IS NULL
     OR to_regclass('public.recon_definitions') IS NULL
     OR to_regclass('public.tenant_members') IS NULL THEN
    RAISE EXCEPTION 'exception dashboard source tables are unavailable';
  END IF;

  IF to_regprocedure('public.user_has_permission(uuid,uuid,text,uuid)') IS NULL
     OR to_regprocedure('public.rate_limit_hit(text,integer,integer)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.permissions WHERE id = 'break.read') THEN
    RAISE EXCEPTION 'exception dashboard permission or rate-limit dependency is unavailable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenant_members' AND column_name = 'active'
  ) THEN
    RAISE EXCEPTION 'exception dashboard requires active tenant membership';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS recon_exceptions_dashboard_window_idx
  ON public.recon_exceptions (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS recon_exceptions_dashboard_open_idx
  ON public.recon_exceptions (tenant_id, created_at, run_id)
  WHERE lifecycle_state NOT IN ('resolved','written_off')
    AND status NOT IN ('resolved','wont_fix');

-- The shared rate_limit_hit function is intentionally executable only by
-- service_role. This private wrapper preserves that boundary while allowing the
-- SECURITY INVOKER dashboard to consume a fixed bucket. It derives auth.uid()
-- and repeats the authorization checks so granting EXECUTE cannot create a
-- generic counter-writing primitive. The private schema is not PostgREST-exposed.
CREATE OR REPLACE FUNCTION private.exception_dashboard_rate_limit_hit(_tenant_id uuid)
RETURNS TABLE(allowed boolean, current_count integer, retry_after_seconds integer)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  actor_id uuid := auth.uid();
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'forbidden: authenticated identity required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.tenant_members membership
    WHERE membership.tenant_id = _tenant_id
      AND membership.user_id = actor_id
      AND membership.active
  ) THEN
    RAISE EXCEPTION 'forbidden: active tenant membership required' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.is_platform_admin(actor_id)
    OR public.user_has_permission(actor_id, _tenant_id, 'break.read', NULL)
  ) THEN
    RAISE EXCEPTION 'forbidden: break.read permission required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT limiter.allowed, limiter.current_count, limiter.retry_after_seconds
  FROM public.rate_limit_hit(
    'exception.dashboard.db:' || _tenant_id::text || ':' || actor_id::text,
    60,
    60
  ) limiter;
END;
$$;

REVOKE ALL ON FUNCTION private.exception_dashboard_rate_limit_hit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.exception_dashboard_rate_limit_hit(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_exception_dashboard(
  _tenant_id uuid,
  _days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
SET row_security = on
AS $$
DECLARE
  actor_id uuid := auth.uid();
  dashboard_as_of timestamptz := statement_timestamp();
  trend_start timestamptz;
  rate_state record;
  result jsonb;
BEGIN
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id is required' USING ERRCODE = '22023';
  END IF;
  IF _days IS NULL OR _days NOT IN (7, 30, 90) THEN
    RAISE EXCEPTION 'days must be one of 7, 30 or 90' USING ERRCODE = '22023';
  END IF;
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'forbidden: authenticated identity required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.tenant_members membership
    WHERE membership.tenant_id = _tenant_id
      AND membership.user_id = actor_id
      AND membership.active
  ) THEN
    RAISE EXCEPTION 'forbidden: active tenant membership required' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.is_platform_admin(actor_id)
    OR public.user_has_permission(actor_id, _tenant_id, 'break.read', NULL)
  ) THEN
    RAISE EXCEPTION 'forbidden: break.read permission required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO rate_state
  FROM private.exception_dashboard_rate_limit_hit(_tenant_id);
  IF NOT rate_state.allowed THEN
    RAISE SQLSTATE 'PGRST' USING
      MESSAGE = jsonb_build_object(
        'code', 'exception_dashboard_rate_limited',
        'message', 'Too many exception dashboard requests',
        'details', 'The per-user, per-tenant limit is 60 requests per minute.',
        'hint', 'Retry after the number of seconds in the Retry-After header.'
      )::text,
      DETAIL = jsonb_build_object(
        'status', 429,
        'headers', jsonb_build_object(
          'Retry-After', GREATEST(1, rate_state.retry_after_seconds)::text
        )
      )::text;
  END IF;

  trend_start := (
    ((dashboard_as_of AT TIME ZONE 'UTC')::date - (_days - 1))::timestamp
    AT TIME ZONE 'UTC'
  );

  WITH scoped AS MATERIALIZED (
    SELECT
      exception.id,
      exception.created_at,
      exception.severity,
      exception.priority,
      exception.assignee,
      CASE
        WHEN exception.lifecycle_state = 'written_off' OR exception.status = 'wont_fix'
          THEN 'written_off'
        WHEN exception.lifecycle_state = 'resolved' OR exception.status = 'resolved'
          THEN 'resolved'
        ELSE exception.lifecycle_state
      END AS canonical_status,
      NOT (
        exception.lifecycle_state IN ('resolved','written_off')
        OR exception.status IN ('resolved','wont_fix')
      ) AS is_open,
      GREATEST(
        0,
        floor(extract(epoch FROM (dashboard_as_of - exception.created_at)) / 86400)::integer
      ) AS age_days,
      definition.id AS reconciliation_id,
      COALESCE(definition.name, 'Unknown reconciliation') AS reconciliation_name
    FROM public.recon_exceptions exception
    LEFT JOIN public.recon_runs run
      ON run.id = exception.run_id
     AND run.tenant_id = exception.tenant_id
    LEFT JOIN public.recon_definitions definition
      ON definition.id = run.definition_id
     AND definition.tenant_id = exception.tenant_id
    WHERE exception.tenant_id = _tenant_id
      AND exception.created_at <= dashboard_as_of
  ),
  totals AS (
    SELECT jsonb_build_object(
      'total', count(*),
      'open', count(*) FILTER (WHERE is_open),
      'resolved', count(*) FILTER (WHERE NOT is_open),
      'high_priority', count(*) FILTER (WHERE is_open AND priority IN ('P1','P2')),
      'unassigned', count(*) FILTER (WHERE is_open AND assignee IS NULL),
      'older_than_30_days', count(*) FILTER (WHERE is_open AND age_days > 30),
      'oldest_open_days', COALESCE(max(age_days) FILTER (WHERE is_open), 0)
    ) AS value
    FROM scoped
  ),
  severity_seed(name, ordinal) AS (
    VALUES ('critical', 1), ('high', 2), ('medium', 3), ('low', 4)
  ),
  severity_counts AS (
    SELECT severity AS name, count(*) AS count
    FROM scoped
    GROUP BY severity
  ),
  status_seed(name, ordinal) AS (
    VALUES
      ('new', 1), ('assigned', 2), ('investigating', 3),
      ('pending_counterparty', 4), ('resolved', 5), ('written_off', 6)
  ),
  status_counts AS (
    SELECT canonical_status AS name, count(*) AS count
    FROM scoped
    GROUP BY canonical_status
  ),
  ageing_counts AS (
    SELECT
      CASE
        WHEN age_days < 3 THEN '0–2'
        WHEN age_days < 8 THEN '3–7'
        WHEN age_days < 31 THEN '8–30'
        WHEN age_days < 91 THEN '31–90'
        ELSE '90+'
      END AS name,
      count(*) AS count
    FROM scoped
    WHERE is_open
    GROUP BY 1
  ),
  ageing_seed(name, ordinal) AS (
    VALUES ('0–2', 1), ('3–7', 2), ('8–30', 3), ('31–90', 4), ('90+', 5)
  ),
  trend_days AS (
    SELECT generated.day::date AS day
    FROM generate_series(
      (trend_start AT TIME ZONE 'UTC')::date,
      (dashboard_as_of AT TIME ZONE 'UTC')::date,
      interval '1 day'
    ) AS generated(day)
  ),
  trend_counts AS (
    SELECT
      (created_at AT TIME ZONE 'UTC')::date AS day,
      count(*) AS created,
      count(*) FILTER (WHERE is_open) AS still_open
    FROM scoped
    WHERE created_at >= trend_start
    GROUP BY 1
  ),
  reconciliation_counts AS (
    SELECT
      reconciliation_id AS id,
      reconciliation_name AS name,
      count(*) AS open_count,
      count(*) FILTER (WHERE priority IN ('P1','P2')) AS high_priority_count,
      max(age_days) AS oldest_open_days
    FROM scoped
    WHERE is_open
    GROUP BY reconciliation_id, reconciliation_name
    ORDER BY count(*) DESC,
             count(*) FILTER (WHERE priority IN ('P1','P2')) DESC,
             max(age_days) DESC,
             reconciliation_name
    LIMIT 10
  )
  SELECT jsonb_build_object(
    'as_of', dashboard_as_of,
    'window_days', _days,
    'totals', (SELECT value FROM totals),
    'by_severity', (
      SELECT jsonb_agg(
        jsonb_build_object('name', seed.name, 'count', COALESCE(counts.count, 0))
        ORDER BY seed.ordinal
      )
      FROM severity_seed seed
      LEFT JOIN severity_counts counts USING (name)
    ),
    'by_status', (
      SELECT jsonb_agg(
        jsonb_build_object('name', seed.name, 'count', COALESCE(counts.count, 0))
        ORDER BY seed.ordinal
      )
      FROM status_seed seed
      LEFT JOIN status_counts counts USING (name)
    ),
    'ageing', (
      SELECT jsonb_agg(
        jsonb_build_object('name', seed.name, 'count', COALESCE(counts.count, 0))
        ORDER BY seed.ordinal
      )
      FROM ageing_seed seed
      LEFT JOIN ageing_counts counts USING (name)
    ),
    'trend', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'date', to_char(days.day, 'YYYY-MM-DD'),
          'created', COALESCE(counts.created, 0),
          'still_open', COALESCE(counts.still_open, 0)
        )
        ORDER BY days.day
      )
      FROM trend_days days
      LEFT JOIN trend_counts counts USING (day)
    ),
    'by_reconciliation', (
      SELECT COALESCE(
        jsonb_agg(jsonb_build_object(
          'id', ranked.id,
          'name', ranked.name,
          'open', ranked.open_count,
          'high_priority', ranked.high_priority_count,
          'oldest_open_days', ranked.oldest_open_days
        ) ORDER BY ranked.open_count DESC, ranked.high_priority_count DESC,
                   ranked.oldest_open_days DESC, ranked.name),
        '[]'::jsonb
      )
      FROM reconciliation_counts ranked
    )
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_exception_dashboard(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_exception_dashboard(uuid, integer) TO authenticated;
