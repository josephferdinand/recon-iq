-- ============================================================================
-- Tenant Exception Forecasts — Sprint 3 Feature 2
-- ============================================================================
-- Time-series heuristic forecasts of per-tenant exception volume for the next
-- N days, computed from a rolling 30-day window, day-of-week patterns, and an
-- anomaly factor (>1.5× rolling median bumps the upper bound).
--
-- The forecast is intentionally simple (no ML): the goal is to give analysts
-- an expectation range ("expected 23, range 18–31") they can use to plan
-- capacity. A heavier ML model belongs in a separate feature.
-- ============================================================================

create table if not exists public.tenant_exception_forecasts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  computed_at timestamptz not null default now(),
  horizon_days int not null default 7 check (horizon_days between 1 and 30),

  -- Aggregate forecast (sum of per-day forecasts)
  expected_count numeric(10, 2) not null default 0,
  lower_count numeric(10, 2) not null default 0,
  upper_count numeric(10, 2) not null default 0,

  -- Diagnostic inputs
  baseline_daily_mean numeric(10, 2) not null default 0,
  baseline_daily_stddev numeric(10, 2) not null default 0,
  rolling_median_30d numeric(10, 2) not null default 0,
  anomaly_factor numeric(5, 3) not null default 1.0,
  is_anomaly_active boolean not null default false,

  -- Per-day forecast: array of { date, expected, lower, upper, dow_factor }
  per_day jsonb not null default '[]'::jsonb,

  -- History sample (last 30 days daily counts, oldest first) for sparkline
  history jsonb not null default '[]'::jsonb,

  computed_by text not null default 'system',
  created_at timestamptz not null default now()
);

create unique index if not exists tenant_exception_forecasts_tenant_latest
  on public.tenant_exception_forecasts (tenant_id, computed_at desc);

create index if not exists tenant_exception_forecasts_tenant_horizon
  on public.tenant_exception_forecasts (tenant_id, horizon_days, computed_at desc);

alter table public.tenant_exception_forecasts enable row level security;
revoke all on table public.tenant_exception_forecasts from anon;
grant select on table public.tenant_exception_forecasts to authenticated;
grant all on table public.tenant_exception_forecasts to service_role;

drop policy if exists "tenant_exception_forecasts_self_read" on public.tenant_exception_forecasts;
create policy "tenant_exception_forecasts_self_read"
  on public.tenant_exception_forecasts
  for select to authenticated
  using (
    exists (
      select 1 from public.tenant_members tm
      where tm.tenant_id = tenant_exception_forecasts.tenant_id
        and tm.user_id = auth.uid()
    )
  );

drop policy if exists "tenant_exception_forecasts_admin_read" on public.tenant_exception_forecasts;
create policy "tenant_exception_forecasts_admin_read"
  on public.tenant_exception_forecasts
  for select to authenticated
  using (public.is_platform_admin(auth.uid()));

drop policy if exists "tenant_exception_forecasts_service_write" on public.tenant_exception_forecasts;
create policy "tenant_exception_forecasts_service_write"
  on public.tenant_exception_forecasts
  for all to service_role
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ============================================================================
-- predict_next_exception_volume(_tenant_id, _horizon_days, _as_of)
--
-- Pure heuristic — no ML:
--   baseline = mean of last 30 days of daily exception counts (excluding today)
--   dow_factor[0..6] = mean for that weekday / overall mean (clamped 0.5..1.5)
--   per_day_expected = baseline * dow_factor * anomaly_factor
--   per_day_lower/upper = per_day_expected ± 1.96 * stddev
--   anomaly_factor = 1.5 if last 3 days > 1.5 * rolling_median, else 1.0
-- ============================================================================
create or replace function public.predict_next_exception_volume(
  _tenant_id uuid,
  _horizon_days int default 7,
  _as_of date default current_date
)
returns public.tenant_exception_forecasts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz := (_as_of - interval '30 days')::timestamptz;
  v_today timestamptz := _as_of::timestamptz;

  v_daily record;
  v_total numeric := 0;
  v_count int := 0;
  v_min numeric := 0;
  v_max numeric := 0;
  v_baseline_mean numeric := 0;
  v_baseline_stddev numeric := 0;
  v_rolling_median numeric := 0;

  v_dow_factor numeric[] := array[1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
  v_dow_means numeric[] := array[0, 0, 0, 0, 0, 0, 0];
  v_dow_samples int[] := array[0, 0, 0, 0, 0, 0, 0];
  v_dow_mean numeric := 0;
  v_dow_sample int := 0;

  v_anomaly_factor numeric := 1.0;
  v_is_anomaly boolean := false;
  v_recent3 numeric := 0;
  v_history jsonb := '[]'::jsonb;
  v_per_day jsonb := '[]'::jsonb;
  v_day date;
  v_dow int;
  v_expected numeric;
  v_lower numeric;
  v_upper numeric;
  v_sum_expected numeric := 0;
  v_sum_lower numeric := 0;
  v_sum_upper numeric := 0;

  v_row public.tenant_exception_forecasts;
begin
  if _tenant_id is null then
    raise exception 'tenant_id is required';
  end if;
  if _horizon_days is null or _horizon_days not between 1 and 30 then
    raise exception 'horizon_days must be between 1 and 30';
  end if;

  -- Per-day counts (last 30 days, excluding today to avoid partial-day bias)
  for v_daily in
    select
      date_trunc('day', created_at)::date as d,
      count(*) as c
    from public.recon_exceptions
    where tenant_id = _tenant_id
      and created_at >= v_window
      and created_at < v_today
    group by 1
  loop
    v_total := v_total + v_daily.c;
    v_count := v_count + 1;
    if v_min = 0 or v_daily.c < v_min then v_min := v_daily.c; end if;
    if v_daily.c > v_max then v_max := v_daily.c; end if;
  end loop;

  if v_count > 0 then
    v_baseline_mean := v_total / v_count;
    -- stddev via sum of squares for two-pass-free approximate
    select coalesce(stddev_pop(c), 0) into v_baseline_stddev
    from (
      select
        date_trunc('day', created_at)::date as d,
        count(*) as c
      from public.recon_exceptions
      where tenant_id = _tenant_id
        and created_at >= v_window
        and created_at < v_today
      group by 1
    ) daily_counts;
  else
    v_baseline_mean := 0;
    v_baseline_stddev := 0;
  end if;

  -- Median over the same window
  select coalesce(percentile_cont(0.5) within group (order by c), 0) into v_rolling_median
  from (
    select date_trunc('day', created_at)::date as d, count(*) as c
    from public.recon_exceptions
    where tenant_id = _tenant_id
      and created_at >= v_window
      and created_at < v_today
    group by 1
  ) daily_counts;

  -- Day-of-week factors from prior 4 weeks
  for i in 0..6 loop
    select coalesce(avg(c), 0), coalesce(count(*), 0)
    into v_dow_mean, v_dow_sample
    from (
      select date_trunc('day', created_at)::date as d, count(*) as c
      from public.recon_exceptions
      where tenant_id = _tenant_id
        and created_at >= (_as_of - interval '28 days')::timestamptz
        and created_at < v_today
        and extract(dow from created_at) = i
      group by 1
    ) dc;
    v_dow_means[i + 1] := v_dow_mean;
    v_dow_samples[i + 1] := v_dow_sample;
  end loop;

  if v_baseline_mean > 0 then
    for i in 0..6 loop
      if v_dow_samples[i + 1] > 0 then
        v_dow_factor[i + 1] := greatest(0.5, least(1.5, v_dow_means[i + 1] / v_baseline_mean));
      else
        v_dow_factor[i + 1] := 1.0;
      end if;
    end loop;
  end if;

  -- Anomaly factor: >1.5× rolling median in last 3 days
  select coalesce(sum(c), 0) into v_recent3
  from (
    select date_trunc('day', created_at)::date as d, count(*) as c
    from public.recon_exceptions
    where tenant_id = _tenant_id
      and created_at >= (_as_of - interval '3 days')::timestamptz
      and created_at < v_today
    group by 1
  ) dc;

  if v_rolling_median > 0 and (v_recent3 / 3.0) > (v_rolling_median * 1.5) then
    v_anomaly_factor := 1.5;
    v_is_anomaly := true;
  else
    v_anomaly_factor := 1.0;
    v_is_anomaly := false;
  end if;

  -- Build history sample (last 30 days)
  select coalesce(jsonb_agg(jsonb_build_object('date', d::text, 'count', c) order by d), '[]'::jsonb)
  into v_history
  from (
    select date_trunc('day', created_at)::date as d, count(*) as c
    from public.recon_exceptions
    where tenant_id = _tenant_id
      and created_at >= v_window
      and created_at < v_today
    group by 1
  ) dc;

  -- Build per-day forecast for next _horizon_days
  for i in 0..(_horizon_days - 1) loop
    v_day := _as_of + i;
    v_dow := extract(dow from v_day)::int; -- 0=Sunday..6=Saturday
    v_expected := round(v_baseline_mean * v_dow_factor[v_dow + 1] * v_anomaly_factor, 1);
    v_lower := greatest(0, round(v_expected - 1.96 * v_baseline_stddev, 1));
    v_upper := round(v_expected + 1.96 * v_baseline_stddev, 1);

    v_per_day := v_per_day || jsonb_build_array(jsonb_build_object(
      'date', v_day::text,
      'expected', v_expected,
      'lower', v_lower,
      'upper', v_upper,
      'dow_factor', v_dow_factor[v_dow + 1]
    ));
    v_sum_expected := v_sum_expected + v_expected;
    v_sum_lower := v_sum_lower + v_lower;
    v_sum_upper := v_sum_upper + v_upper;
  end loop;

  insert into public.tenant_exception_forecasts (
    tenant_id, horizon_days,
    expected_count, lower_count, upper_count,
    baseline_daily_mean, baseline_daily_stddev, rolling_median_30d,
    anomaly_factor, is_anomaly_active,
    per_day, history, computed_by
  )
  values (
    _tenant_id, _horizon_days,
    v_sum_expected, v_sum_lower, v_sum_upper,
    round(v_baseline_mean, 2), round(v_baseline_stddev, 2), round(v_rolling_median, 2),
    v_anomaly_factor, v_is_anomaly,
    v_per_day, v_history, 'system'
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.predict_next_exception_volume(uuid, int, date) from public, anon, authenticated;
grant execute on function public.predict_next_exception_volume(uuid, int, date) to service_role;

create or replace function public.get_latest_exception_forecast(_tenant_id uuid)
returns public.tenant_exception_forecasts
language sql
security invoker
set search_path = public
as $$
  select *
  from public.tenant_exception_forecasts
  where tenant_id = _tenant_id
  order by computed_at desc
  limit 1;
$$;

revoke all on function public.get_latest_exception_forecast(uuid) from public, anon;
grant execute on function public.get_latest_exception_forecast(uuid) to authenticated, service_role;
