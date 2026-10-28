
-- 1. INSERT policies (admin-only) for tables that previously granted INSERT
--    to `authenticated` with no matching policy.
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'login_anomaly_events',
    'promotion_snapshots',
    'data_source_runs',
    'recon_schedule_runs',
    'aidp_api_quotas',
    'observability_alert_incidents'
  ])
  loop
    execute format($f$
      drop policy if exists "%1$s admin insert" on public.%1$I;
      create policy "%1$s admin insert" on public.%1$I
        for insert to authenticated
        with check (public.is_platform_admin(auth.uid()))
    $f$, t);
  end loop;
end $$;

-- SCIM sync log — writes come from service_role only.
revoke insert on public.scim_sync_log from authenticated;

-- Chat sessions — user creates their own row.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='mkt_chat_sessions' and column_name='user_id') then
    execute $f$
      drop policy if exists "mkt_chat_sessions insert own" on public.mkt_chat_sessions;
      create policy "mkt_chat_sessions insert own" on public.mkt_chat_sessions
        for insert to authenticated
        with check (auth.uid() = user_id)
    $f$;
  end if;
end $$;

-- 2. Pin search_path on trigger functions.
create or replace function public.mkt_brand_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.touch_scim_provisioning_settings()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
