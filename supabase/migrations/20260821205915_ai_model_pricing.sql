-- AI Model Pricing rate card.
--
-- The original schema stored one `provider/model` key with per-1K rates. This
-- migration upgrades that legacy table in place and is also safe when the
-- current per-million schema already exists.

do $migration$
declare
  v_has_legacy_schema boolean;
  v_has_current_schema boolean;
begin
  if to_regclass('public.ai_model_pricing') is null then
    create table public.ai_model_pricing (
      id uuid primary key default gen_random_uuid(),
      provider_code text not null,
      model_key text not null,
      input_usd_per_1m numeric(10, 6) not null check (input_usd_per_1m >= 0),
      output_usd_per_1m numeric(10, 6) not null check (output_usd_per_1m >= 0),
      currency text not null default 'USD',
      active boolean not null default true,
      effective_at timestamptz not null default now(),
      expires_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  else
    select
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'ai_model_pricing' and column_name = 'model'
      ),
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'ai_model_pricing' and column_name = 'provider_code'
      )
    into v_has_legacy_schema, v_has_current_schema;

    if v_has_legacy_schema and not v_has_current_schema then
      alter table public.ai_model_pricing
        add column id uuid default gen_random_uuid(),
        add column provider_code text,
        add column model_key text,
        add column input_usd_per_1m numeric(10, 6),
        add column output_usd_per_1m numeric(10, 6),
        add column currency text not null default 'USD',
        add column active boolean not null default true,
        add column effective_at timestamptz not null default now(),
        add column expires_at timestamptz,
        add column created_at timestamptz not null default now();

      update public.ai_model_pricing
      set provider_code = case
            when position('/' in model) > 0 then split_part(model, '/', 1)
            else 'legacy'
          end,
          model_key = case
            when position('/' in model) > 0 then substring(model from position('/' in model) + 1)
            else model
          end,
          input_usd_per_1m = input_per_1k_usd * 1000,
          output_usd_per_1m = output_per_1k_usd * 1000;

      alter table public.ai_model_pricing
        alter column id set not null,
        alter column provider_code set not null,
        alter column model_key set not null,
        alter column input_usd_per_1m set not null,
        alter column output_usd_per_1m set not null,
        drop constraint if exists ai_model_pricing_pkey,
        drop column model,
        drop column input_per_1k_usd,
        drop column output_per_1k_usd,
        drop column updated_by,
        add constraint ai_model_pricing_pkey primary key (id);
    elsif not v_has_current_schema then
      raise exception 'ai_model_pricing has an unsupported intermediate schema';
    end if;
  end if;
end
$migration$;

create unique index if not exists ai_model_pricing_provider_model_effective_uq
  on public.ai_model_pricing (provider_code, model_key, effective_at);

create index if not exists ai_model_pricing_lookup
  on public.ai_model_pricing (provider_code, model_key)
  where active = true;

alter table public.ai_model_pricing enable row level security;

drop policy if exists amp_read on public.ai_model_pricing;
drop policy if exists amp_admin on public.ai_model_pricing;
drop policy if exists ai_model_pricing_read on public.ai_model_pricing;
create policy ai_model_pricing_read
  on public.ai_model_pricing
  for select to authenticated
  using (active = true);

drop policy if exists ai_model_pricing_admin_write on public.ai_model_pricing;
create policy ai_model_pricing_admin_write
  on public.ai_model_pricing
  for all to authenticated
  using (public.is_platform_admin(auth.uid()))
  with check (public.is_platform_admin(auth.uid()));

revoke all on table public.ai_model_pricing from public, anon, authenticated;
grant select on table public.ai_model_pricing to authenticated;
grant all on table public.ai_model_pricing to service_role;

-- Fixed effective timestamp makes clean-room replay deterministic.
insert into public.ai_model_pricing (
  provider_code,
  model_key,
  input_usd_per_1m,
  output_usd_per_1m,
  effective_at
) values
  ('muse', 'gpt-4o',                  2.50, 10.00, '2026-08-21 20:59:15+00'),
  ('muse', 'gpt-4o-mini',             0.15,  0.60, '2026-08-21 20:59:15+00'),
  ('muse', 'gpt-4-turbo',            10.00, 30.00, '2026-08-21 20:59:15+00'),
  ('muse', 'gpt-3.5-turbo',           0.50,  1.50, '2026-08-21 20:59:15+00'),
  ('anthropic', 'claude-sonnet-4-5',    3.00, 15.00, '2026-08-21 20:59:15+00'),
  ('anthropic', 'claude-haiku-4-5',     0.80,  4.00, '2026-08-21 20:59:15+00'),
  ('anthropic', 'claude-opus-4-1',     15.00, 75.00, '2026-08-21 20:59:15+00'),
  ('google', 'gemini-2.5-pro',           1.25, 10.00, '2026-08-21 20:59:15+00'),
  ('google', 'gemini-2.5-flash',         0.075, 0.30, '2026-08-21 20:59:15+00'),
  ('google', 'gemini-3-flash-preview',   0.10,  0.40, '2026-08-21 20:59:15+00')
on conflict (provider_code, model_key, effective_at) do nothing;
