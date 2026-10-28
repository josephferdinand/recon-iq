-- AI usage aggregation functions for anomaly detection cron.

create or replace function public.ai_usage_daily_rollup(_since timestamptz)
returns table (
  tenant_id uuid,
  total_cost_usd numeric,
  total_tokens bigint,
  request_count bigint
)
language sql
security definer
set search_path = public
as $$
  select
    e.tenant_id,
    coalesce(sum(e.cost_usd), 0)::numeric as total_cost_usd,
    coalesce(sum(e.tokens_in + e.tokens_out), 0)::bigint as total_tokens,
    count(*)::bigint as request_count
  from ai_usage_events e
  where e.created_at >= _since
    and e.tenant_id is not null
  group by e.tenant_id;
$$;

revoke all on function public.ai_usage_daily_rollup(timestamptz) from public;
grant execute on function public.ai_usage_daily_rollup(timestamptz) to service_role;

-- Returns average daily cost per tenant over the last N days (excluding today),
-- so the cron can compute a rolling baseline to detect spikes.
create or replace function public.ai_usage_tenant_history(_days int)
returns table (
  tenant_id uuid,
  total_cost_usd numeric
)
language sql
security definer
set search_path = public
as $$
  select
    e.tenant_id,
    (sum(e.cost_usd) / greatest(_days, 1))::numeric as total_cost_usd
  from ai_usage_events e
  where e.created_at >= now() - (_days || ' days')::interval
    and e.created_at <  now() - interval '1 day'
    and e.tenant_id is not null
  group by e.tenant_id;
$$;

revoke all on function public.ai_usage_tenant_history(int) from public;
grant execute on function public.ai_usage_tenant_history(int) to service_role;
