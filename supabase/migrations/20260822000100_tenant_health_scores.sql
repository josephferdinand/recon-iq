-- ============================================================================
-- Tenant Health Score — Sprint 3 Feature 1
-- ============================================================================
-- Per-tenant reconciliation health score (0–100), broken down by:
--   match quality, exception volume, time-to-resolve, rule coverage, AI confidence.
-- A daily cron recomputes the score for every active tenant; the API exposes
-- the latest snapshot plus a 30-day trend.
--
-- The score is intentionally a derived projection: never trust a single
-- statistic. The function `compute_tenant_health_score(tenant_id)` recomputes
-- from raw tables and writes the result to `tenant_health_scores`.
-- ============================================================================

create table if not exists public.tenant_health_scores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  computed_at timestamptz not null default now(),
  window_days int not null default 30 check (window_days between 1 and 180),

  -- Composite score 0–100 (higher = healthier)
  overall_score numeric(5, 2) not null check (overall_score between 0 and 100),

  -- Sub-scores (each 0–100)
  match_quality_score numeric(5, 2) not null check (match_quality_score between 0 and 100),
  exception_volume_score numeric(5, 2) not null check (exception_volume_score between 0 and 100),
  time_to_resolve_score numeric(5, 2) not null check (time_to_resolve_score between 0 and 100),
  rule_coverage_score numeric(5, 2) not null check (rule_coverage_score between 0 and 100),
  ai_confidence_score numeric(5, 2) not null check (ai_confidence_score between 0 and 100),

  -- Counts surfaced for the dashboard
  runs_analyzed bigint not null default 0,
  exceptions_open bigint not null default 0,
  exceptions_resolved_30d bigint not null default 0,
  rules_total int not null default 0,
  rules_active int not null default 0,
  avg_match_rate numeric(5, 4) not null default 0,
  median_ttr_hours numeric(10, 2) not null default 0,

  -- Trend array (last 14 daily overall_scores, oldest first)
  trend jsonb not null default '[]'::jsonb,

  -- Top issues — actionable items the analyst should fix
  top_issues jsonb not null default '[]'::jsonb,

  -- Ingestion metadata for audit
  computed_by text not null default 'system',
  created_at timestamptz not null default now()
);

create unique index if not exists tenant_health_scores_tenant_latest
  on public.tenant_health_scores (tenant_id, computed_at desc);

create index if not exists tenant_health_scores_tenant_window
  on public.tenant_health_scores (tenant_id, window_days, computed_at desc);

alter table public.tenant_health_scores enable row level security;
revoke all on table public.tenant_health_scores from anon;
grant select on table public.tenant_health_scores to authenticated;
grant all on table public.tenant_health_scores to service_role;

-- Tenant members read their own tenant's health snapshots.
drop policy if exists "tenant_health_scores_self_read" on public.tenant_health_scores;
create policy "tenant_health_scores_self_read"
  on public.tenant_health_scores
  for select to authenticated
  using (
    exists (
      select 1 from public.tenant_members tm
      where tm.tenant_id = tenant_health_scores.tenant_id
        and tm.user_id = auth.uid()
    )
  );

-- Platform admins read across all tenants.
drop policy if exists "tenant_health_scores_admin_read" on public.tenant_health_scores;
create policy "tenant_health_scores_admin_read"
  on public.tenant_health_scores
  for select to authenticated
  using (public.is_platform_admin(auth.uid()));

-- Only service_role writes (cron + compute function).
drop policy if exists "tenant_health_scores_service_write" on public.tenant_health_scores;
create policy "tenant_health_scores_service_write"
  on public.tenant_health_scores
  for all to service_role
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ============================================================================
-- compute_tenant_health_score(tenant_id, window_days)
-- Pure SQL — recomputes the score from raw tables and inserts a snapshot row.
-- Idempotent: a duplicate call within the same second is allowed; older rows
-- are kept for trend analysis.
-- ============================================================================
create or replace function public.compute_tenant_health_score(
  _tenant_id uuid,
  _window_days int default 30
)
returns public.tenant_health_scores
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz := now() - make_interval(days => _window_days);
  v_runs_total bigint := 0;
  v_runs_matched bigint := 0;
  v_runs_unmatched bigint := 0;
  v_match_rate numeric := 0;
  v_ex_open bigint := 0;
  v_ex_resolved bigint := 0;
  v_total_ex_for_ttr bigint := 0;
  v_sum_ttr_hours numeric := 0;
  v_median_ttr_hours numeric := 0;
  v_rules_total int := 0;
  v_rules_active int := 0;
  v_rules_used int := 0;
  v_ai_total bigint := 0;
  v_ai_high_conf bigint := 0;
  v_ai_avg_conf numeric := 0;

  v_match_score numeric := 0;
  v_exception_score numeric := 0;
  v_ttr_score numeric := 0;
  v_rule_score numeric := 0;
  v_ai_score numeric := 0;
  v_overall numeric := 0;
  v_trend jsonb := '[]'::jsonb;
  v_top_issues jsonb := '[]'::jsonb;
  v_row public.tenant_health_scores;
begin
  if _tenant_id is null then
    raise exception 'tenant_id is required';
  end if;
  if _window_days is null or _window_days not between 1 and 180 then
    raise exception 'window_days must be between 1 and 180';
  end if;

  -- Match quality: ratio of matched vs (matched + unmatched) across runs in window
  select
    count(*),
    coalesce(sum(matched_count), 0),
    coalesce(sum(greatest(total_rows - matched_count, 0)), 0)
  into v_runs_total, v_runs_matched, v_runs_unmatched
  from public.recon_runs
  where tenant_id = _tenant_id
    and started_at >= v_window;

  if (v_runs_matched + v_runs_unmatched) > 0 then
    v_match_rate := v_runs_matched::numeric / (v_runs_matched + v_runs_unmatched);
  else
    v_match_rate := 0;
  end if;
  -- Map match_rate 0..1 → 0..100 with floor of 30 if any data exists
  v_match_score := case
    when v_runs_total = 0 then 50.0
    when v_match_rate >= 0.98 then 100.0
    when v_match_rate >= 0.95 then 90.0
    when v_match_rate >= 0.90 then 80.0
    when v_match_rate >= 0.80 then 65.0
    when v_match_rate >= 0.70 then 50.0
    when v_match_rate >= 0.50 then 30.0
    else 15.0
  end;

  -- Exception volume: penalize open exception backlog
  select count(*) into v_ex_open
  from public.recon_exceptions
  where tenant_id = _tenant_id and status = 'open';

  select count(*) into v_ex_resolved
  from public.recon_exceptions
  where tenant_id = _tenant_id
    and status = 'resolved'
    and resolved_at >= v_window;

  v_exception_score := case
    when v_ex_open = 0 then 100.0
    when v_ex_open <= 5 then 90.0
    when v_ex_open <= 20 then 75.0
    when v_ex_open <= 50 then 60.0
    when v_ex_open <= 200 then 40.0
    when v_ex_open <= 500 then 20.0
    else 5.0
  end;

  -- Time-to-resolve: median hours from created_at to resolved_at for closed exceptions
  select
    count(*),
    coalesce(sum(extract(epoch from (resolved_at - created_at)) / 3600.0), 0)
  into v_total_ex_for_ttr, v_sum_ttr_hours
  from public.recon_exceptions
  where tenant_id = _tenant_id
    and status = 'resolved'
    and resolved_at is not null
    and resolved_at >= v_window;

  if v_total_ex_for_ttr > 0 then
    -- Cheap approximation of median using percentile_cont
    select coalesce(percentile_cont(0.5) within group (
      order by extract(epoch from (resolved_at - created_at)) / 3600.0
    ), 0)
    into v_median_ttr_hours
    from public.recon_exceptions
    where tenant_id = _tenant_id
      and status = 'resolved'
      and resolved_at is not null
      and resolved_at >= v_window;
  else
    v_median_ttr_hours := 0;
  end if;

  v_ttr_score := case
    when v_total_ex_for_ttr = 0 then 80.0
    when v_median_ttr_hours <= 2 then 100.0
    when v_median_ttr_hours <= 8 then 90.0
    when v_median_ttr_hours <= 24 then 75.0
    when v_median_ttr_hours <= 72 then 55.0
    when v_median_ttr_hours <= 168 then 35.0
    else 15.0
  end;

  -- Rule coverage: ratio of active rules actually used in recent runs.
  select count(*) into v_rules_total
  from public.recon_definitions
  where tenant_id = _tenant_id;

  select count(*) into v_rules_active
  from public.recon_definitions
  where tenant_id = _tenant_id and status = 'active';

  if v_rules_total = 0 then
    v_rule_score := 20.0; -- no rules at all is a coverage hole
  else
    v_rule_score := least(100.0, (v_rules_active::numeric / v_rules_total) * 100.0);
  end if;

  -- AI confidence: from ai_usage_events; if no AI usage, neutral 70.
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'ai_usage_events'
  ) then
    execute $sql$
      select
        count(*),
        coalesce(sum(case when (meta->>'confidence')::numeric >= 0.85 then 1 else 0 end), 0),
        coalesce(avg((meta->>'confidence')::numeric), 0)
      from public.ai_usage_events
      where tenant_id = $1
        and created_at >= $2
        and meta ? 'confidence'
        and jsonb_typeof(meta->'confidence') = 'number'
    $sql$ into v_ai_total, v_ai_high_conf, v_ai_avg_conf
    using _tenant_id, v_window;

    v_ai_score := case
      when v_ai_total = 0 then 70.0
      when v_ai_avg_conf >= 0.95 then 100.0
      when v_ai_avg_conf >= 0.85 then 85.0
      when v_ai_avg_conf >= 0.70 then 70.0
      when v_ai_avg_conf >= 0.50 then 50.0
      else 25.0
    end;
  else
    v_ai_score := 70.0;
  end if;

  -- Overall = weighted average (match 30%, exceptions 20%, ttr 20%, rules 15%, ai 15%)
  v_overall := round(
    (v_match_score * 0.30)
    + (v_exception_score * 0.20)
    + (v_ttr_score * 0.20)
    + (v_rule_score * 0.15)
    + (v_ai_score * 0.15),
    2
  );

  -- Build trend from prior 14 daily snapshots (or zeros if missing)
  select coalesce(jsonb_agg(d.overall_score order by d.computed_at), '[]'::jsonb)
  into v_trend
  from (
    select overall_score, computed_at
    from public.tenant_health_scores
    where tenant_id = _tenant_id
      and computed_at >= now() - interval '14 days'
      and computed_at < now()
    order by computed_at desc
    limit 14
  ) d;
  v_trend := coalesce(v_trend, '[]'::jsonb) || jsonb_build_array(v_overall);

  -- Build top issues: a small prioritized list
  v_top_issues := jsonb_build_array(
    case when v_ex_open > 20 then jsonb_build_object(
      'severity', 'high',
      'category', 'exceptions',
      'message', format('%s open exceptions need triage', v_ex_open)
    ) end,
    case when v_match_rate < 0.85 and v_runs_total > 0 then jsonb_build_object(
      'severity', 'high',
      'category', 'match_quality',
      'message', format('Match rate is %s%% — below 85%% target', round(v_match_rate * 100, 1))
    ) end,
    case when v_rules_total = 0 then jsonb_build_object(
      'severity', 'medium',
      'category', 'rules',
      'message', 'No reconciliation rules configured'
    ) when v_rules_active = 0 then jsonb_build_object(
      'severity', 'medium',
      'category', 'rules',
      'message', 'All rules are inactive — none will match'
    ) end,
    case when v_median_ttr_hours > 72 and v_total_ex_for_ttr > 0 then jsonb_build_object(
      'severity', 'medium',
      'category', 'ttr',
      'message', format('Median time-to-resolve is %sh — target <24h', round(v_median_ttr_hours, 0))
    ) end
  );
  v_top_issues := (
    select coalesce(jsonb_agg(x order by x->>'severity' nulls last), '[]'::jsonb)
    from jsonb_array_elements(v_top_issues) x
    where x <> 'null'::jsonb
  );

  insert into public.tenant_health_scores (
    tenant_id, window_days,
    overall_score,
    match_quality_score, exception_volume_score, time_to_resolve_score,
    rule_coverage_score, ai_confidence_score,
    runs_analyzed, exceptions_open, exceptions_resolved_30d,
    rules_total, rules_active,
    avg_match_rate, median_ttr_hours,
    trend, top_issues,
    computed_by
  )
  values (
    _tenant_id, _window_days,
    v_overall,
    v_match_score, v_exception_score, v_ttr_score,
    v_rule_score, v_ai_score,
    v_runs_total, v_ex_open, v_ex_resolved,
    v_rules_total, v_rules_active,
    v_match_rate, v_median_ttr_hours,
    v_trend, v_top_issues,
    'system'
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.compute_tenant_health_score(uuid, int) from public, anon, authenticated;
grant execute on function public.compute_tenant_health_score(uuid, int) to service_role;

-- ============================================================================
-- Latest snapshot fetch (cheap, RLS-scoped)
-- ============================================================================
create or replace function public.get_latest_tenant_health(_tenant_id uuid)
returns public.tenant_health_scores
language sql
security invoker
set search_path = public
as $$
  select *
  from public.tenant_health_scores
  where tenant_id = _tenant_id
  order by computed_at desc
  limit 1;
$$;

revoke all on function public.get_latest_tenant_health(uuid) from public, anon;
grant execute on function public.get_latest_tenant_health(uuid) to authenticated, service_role;

-- ============================================================================
-- 30-day trend for sparkline (one row per day, oldest first)
-- ============================================================================
create or replace function public.get_tenant_health_trend(_tenant_id uuid, _days int default 30)
returns table (day date, overall_score numeric)
language sql
security invoker
set search_path = public
as $$
  with days as (
    select generate_series(
      (current_date - (_days - 1))::date,
      current_date::date,
      '1 day'::interval
    )::date as day
  ),
  ranked as (
    select
      date_trunc('day', computed_at)::date as day,
      overall_score,
      row_number() over (
        partition by date_trunc('day', computed_at)::date
        order by computed_at desc
      ) as rn
    from public.tenant_health_scores
    where tenant_id = _tenant_id
      and computed_at >= (current_date - _days + 1)
  )
  select
    d.day,
    coalesce(r.overall_score, 0) as overall_score
  from days d
  left join ranked r on r.day = d.day and r.rn = 1
  order by d.day asc;
$$;

revoke all on function public.get_tenant_health_trend(uuid, int) from public, anon;
grant execute on function public.get_tenant_health_trend(uuid, int) to authenticated, service_role;
