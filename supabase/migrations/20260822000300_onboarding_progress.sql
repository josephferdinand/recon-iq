-- ============================================================================
-- Onboarding Progress — Sprint 3 Feature 3
-- ============================================================================
-- Persisted state for the multi-step tenant onboarding wizard. Each user has
-- at most one row per tenant; the wizard can resume after a browser close.
-- ============================================================================

create table if not exists public.onboarding_progress (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Wizard state
  current_step int not null default 1 check (current_step between 1 and 6),
  completed_steps jsonb not null default '[]'::jsonb,

  -- Per-step payloads (all optional, validated server-side)
  step1_tenant jsonb,           -- { name, region, default_currency }
  step2_data_source jsonb,      -- { type: 'file' | 'api' | 'bank_feed', config }
  step3_rule jsonb,             -- { template_id | rule_definition }
  step4_team jsonb,             -- { invites: [{ email, role }] }
  step5_sso jsonb,              -- { provider: 'okta'|'entra'|'google', metadata_url }
  step6_first_run jsonb,        -- { recon_definition_id, status, started_at, finished_at }

  -- Lifecycle
  started_at timestamptz not null default now(),
  last_resumed_at timestamptz not null default now(),
  completed_at timestamptz,

  -- Constraints
  unique (tenant_id, user_id),
  check (
    (completed_at is null)
    or (completed_at >= started_at)
  )
);

create index if not exists onboarding_progress_user_idx
  on public.onboarding_progress (user_id, last_resumed_at desc);

create index if not exists onboarding_progress_tenant_idx
  on public.onboarding_progress (tenant_id, last_resumed_at desc);

alter table public.onboarding_progress enable row level security;
revoke all on table public.onboarding_progress from anon;
grant select, insert, update on table public.onboarding_progress to authenticated;
grant all on table public.onboarding_progress to service_role;

-- Only the user who started the wizard can read/update their own progress.
drop policy if exists "onboarding_progress_owner_read" on public.onboarding_progress;
create policy "onboarding_progress_owner_read"
  on public.onboarding_progress
  for select to authenticated
  using (user_id = auth.uid() and public.is_tenant_member(auth.uid(), tenant_id));

drop policy if exists "onboarding_progress_owner_write" on public.onboarding_progress;
create policy "onboarding_progress_owner_write"
  on public.onboarding_progress
  for all to authenticated
  using (user_id = auth.uid() and public.is_tenant_member(auth.uid(), tenant_id))
  with check (user_id = auth.uid() and public.is_tenant_member(auth.uid(), tenant_id));

-- Service role bypass for cron / admin tooling
drop policy if exists "onboarding_progress_service" on public.onboarding_progress;
create policy "onboarding_progress_service"
  on public.onboarding_progress
  for all to service_role
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ============================================================================
-- upsert_onboarding_step(_tenant_id, _step, _payload)
-- Atomic step update — increments current_step if step > current_step, adds
-- to completed_steps, and updates last_resumed_at.
-- ============================================================================
create or replace function public.upsert_onboarding_step(
  _tenant_id uuid,
  _step int,
  _payload jsonb
)
returns public.onboarding_progress
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.onboarding_progress;
  v_completed jsonb;
  v_existing public.onboarding_progress;
begin
  if v_user is null then
    raise exception 'Unauthorized';
  end if;
  if _step is null or _step not between 1 and 6 then
    raise exception 'step must be between 1 and 6';
  end if;

  -- Tenant membership check (must be a member)
  if not exists (
    select 1 from public.tenant_members
    where tenant_id = _tenant_id and user_id = v_user
  ) then
    raise exception 'Not a member of this tenant';
  end if;

  select * into v_existing
  from public.onboarding_progress
  where tenant_id = _tenant_id and user_id = v_user
  for update;

  if not found then
    insert into public.onboarding_progress (
      tenant_id, user_id, current_step, completed_steps,
      step1_tenant, step2_data_source, step3_rule,
      step4_team, step5_sso, step6_first_run
    ) values (
      _tenant_id, v_user, least(_step + 1, 6), jsonb_build_array(_step),
      case when _step = 1 then _payload end,
      case when _step = 2 then _payload end,
      case when _step = 3 then _payload end,
      case when _step = 4 then _payload end,
      case when _step = 5 then _payload end,
      case when _step = 6 then _payload end
    )
    returning * into v_row;
  else
    v_completed := v_existing.completed_steps ||
      case when v_existing.completed_steps @> jsonb_build_array(_step)
           then '[]'::jsonb
           else jsonb_build_array(_step)
      end;

    update public.onboarding_progress
    set
      current_step = greatest(current_step, least(_step + 1, 6)),
      completed_steps = v_completed,
      step1_tenant = case when _step = 1 then _payload else step1_tenant end,
      step2_data_source = case when _step = 2 then _payload else step2_data_source end,
      step3_rule = case when _step = 3 then _payload else step3_rule end,
      step4_team = case when _step = 4 then _payload else step4_team end,
      step5_sso = case when _step = 5 then _payload else step5_sso end,
      step6_first_run = case when _step = 6 then _payload else step6_first_run end,
      last_resumed_at = now()
    where id = v_existing.id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke all on function public.upsert_onboarding_step(uuid, int, jsonb) from public, anon;
grant execute on function public.upsert_onboarding_step(uuid, int, jsonb) to authenticated;

-- ============================================================================
-- complete_onboarding(_tenant_id) — marks wizard complete
-- ============================================================================
create or replace function public.complete_onboarding(_tenant_id uuid)
returns public.onboarding_progress
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.onboarding_progress;
begin
  if v_user is null then
    raise exception 'Unauthorized';
  end if;

  update public.onboarding_progress
  set completed_at = now(), last_resumed_at = now(), current_step = 6
  where tenant_id = _tenant_id and user_id = v_user and completed_at is null
  returning * into v_row;

  if not found then
    raise exception 'No onboarding in progress for this tenant';
  end if;

  return v_row;
end;
$$;

revoke all on function public.complete_onboarding(uuid) from public, anon;
grant execute on function public.complete_onboarding(uuid) to authenticated;
