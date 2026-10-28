-- Canonicalize the live AI pricing surface after read-only catalog comparison
-- found broader PROD policies and non-deterministic column/index definitions.

begin;

lock table public.ai_model_pricing in share row exclusive mode;

do $preflight$
begin
  if exists (
    select 1 from public.ai_model_pricing
    where currency is null
       or input_usd_per_1m is null
       or output_usd_per_1m is null
       or abs(input_usd_per_1m) >= 10000
       or abs(output_usd_per_1m) >= 10000
       or input_usd_per_1m <> round(input_usd_per_1m, 6)
       or output_usd_per_1m <> round(output_usd_per_1m, 6)
  ) then
    raise exception 'ai_model_pricing values do not fit canonical numeric(10,6) schema';
  end if;

  if to_regprocedure('public.is_platform_admin(uuid)') is null then
    raise exception 'required platform-admin authorization helper is missing';
  end if;
end
$preflight$;

alter table public.ai_model_pricing
  alter column input_usd_per_1m type numeric(10, 6) using input_usd_per_1m::numeric(10, 6),
  alter column output_usd_per_1m type numeric(10, 6) using output_usd_per_1m::numeric(10, 6),
  alter column currency set default 'USD';

alter table public.ai_model_pricing
  drop constraint if exists ai_model_pricing_provider_model_uniq;
drop index if exists public.ai_model_pricing_provider_model_uniq;

do $index_name$
begin
  if to_regclass('public.ai_model_pricing_provider_model_effective_uq') is null
     and to_regclass('public.ai_model_pricing_provider_model_eff_uniq') is not null then
    alter index public.ai_model_pricing_provider_model_eff_uniq
      rename to ai_model_pricing_provider_model_effective_uq;
  end if;
end
$index_name$;

create unique index if not exists ai_model_pricing_provider_model_effective_uq
  on public.ai_model_pricing (provider_code, model_key, effective_at);

drop policy if exists amp_read on public.ai_model_pricing;
drop policy if exists amp_admin on public.ai_model_pricing;
drop policy if exists ai_model_pricing_read on public.ai_model_pricing;
drop policy if exists ai_model_pricing_admin_write on public.ai_model_pricing;

create policy ai_model_pricing_read
  on public.ai_model_pricing
  for select to authenticated
  using (active = true);

create policy ai_model_pricing_admin_write
  on public.ai_model_pricing
  for all to authenticated
  using (public.is_platform_admin(auth.uid()))
  with check (public.is_platform_admin(auth.uid()));

revoke all on table public.ai_model_pricing from public, anon, authenticated;
grant select on table public.ai_model_pricing to authenticated;
grant all on table public.ai_model_pricing to service_role;

commit;
