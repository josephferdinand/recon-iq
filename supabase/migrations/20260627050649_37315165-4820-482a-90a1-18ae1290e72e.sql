
create extension if not exists citext;
create extension if not exists pgcrypto;

-- ENUMS
create type public.platform_role as enum ('platform_admin', 'platform_member');
create type public.tenant_role as enum ('tenant_admin', 'tenant_analyst', 'tenant_viewer');
create type public.env_tier as enum ('dev', 'uat', 'prod');

-- PROFILES
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email citext not null,
  full_name text,
  avatar_url text,
  default_tenant_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "Users read own profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "Users update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "Users insert own profile" on public.profiles for insert to authenticated with check (id = auth.uid());

-- PLATFORM ROLES
create table public.platform_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.platform_role not null,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.platform_roles to authenticated;
grant all on public.platform_roles to service_role;
alter table public.platform_roles enable row level security;

create or replace function public.has_platform_role(_user_id uuid, _role public.platform_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.is_platform_admin(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_platform_role(_user_id, 'platform_admin')
$$;

create policy "Users read own platform roles" on public.platform_roles for select to authenticated using (user_id = auth.uid());
create policy "Platform admins read all platform roles" on public.platform_roles for select to authenticated using (public.is_platform_admin(auth.uid()));
create policy "Platform admins manage platform roles" on public.platform_roles for all to authenticated
  using (public.is_platform_admin(auth.uid())) with check (public.is_platform_admin(auth.uid()));

-- TENANT FAMILIES
create table public.tenant_families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  allow_skip_uat boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.tenant_families to authenticated;
grant all on public.tenant_families to service_role;
alter table public.tenant_families enable row level security;

-- TENANTS
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.tenant_families(id) on delete cascade,
  slug citext not null unique,
  name text not null,
  environment public.env_tier not null default 'dev',
  ai_enabled boolean not null default false,
  custom_domain citext unique,
  domain_verification_token text,
  domain_verified_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, environment),
  constraint tenants_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]$'),
  constraint tenants_slug_not_reserved check (slug not in (
    'admin','platform','api','auth','www','app','tenants','workspace',
    'kb','support','promotions','families','settings','public','assets'
  ))
);
create index tenants_family_idx on public.tenants(family_id);
grant select on public.tenants to authenticated;
grant all on public.tenants to service_role;
alter table public.tenants enable row level security;

-- TENANT MEMBERS
create table public.tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.tenant_role not null,
  invited_by uuid references auth.users(id),
  joined_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index tenant_members_tenant_idx on public.tenant_members(tenant_id);
create index tenant_members_user_idx on public.tenant_members(user_id);
grant select, insert, update, delete on public.tenant_members to authenticated;
grant all on public.tenant_members to service_role;
alter table public.tenant_members enable row level security;

create or replace function public.is_tenant_member(_user_id uuid, _tenant_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tenant_members where user_id = _user_id and tenant_id = _tenant_id)
$$;

create or replace function public.has_tenant_role(_user_id uuid, _tenant_id uuid, _role public.tenant_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tenant_members where user_id = _user_id and tenant_id = _tenant_id and role = _role)
$$;

create policy "Members read their families" on public.tenant_families for select to authenticated using (
  public.is_platform_admin(auth.uid()) or exists (
    select 1 from public.tenants t join public.tenant_members tm on tm.tenant_id = t.id
    where t.family_id = tenant_families.id and tm.user_id = auth.uid()
  )
);
create policy "Platform admins manage families" on public.tenant_families for all to authenticated
  using (public.is_platform_admin(auth.uid())) with check (public.is_platform_admin(auth.uid()));

create policy "Members read their tenants" on public.tenants for select to authenticated using (
  public.is_platform_admin(auth.uid()) or public.is_tenant_member(auth.uid(), id)
);
create policy "Platform admins manage tenants" on public.tenants for all to authenticated
  using (public.is_platform_admin(auth.uid())) with check (public.is_platform_admin(auth.uid()));

create policy "Members read membership in their tenants" on public.tenant_members for select to authenticated using (
  public.is_platform_admin(auth.uid()) or user_id = auth.uid()
  or public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
);
create policy "Tenant admins manage their members" on public.tenant_members for all to authenticated
  using (public.is_platform_admin(auth.uid()) or public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'))
  with check (public.is_platform_admin(auth.uid()) or public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));

-- SLUG HISTORY
create table public.tenant_slug_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  old_slug citext not null unique,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days')
);
create index tenant_slug_history_old_slug_idx on public.tenant_slug_history(old_slug);
grant select on public.tenant_slug_history to authenticated;
grant select on public.tenant_slug_history to anon;
grant all on public.tenant_slug_history to service_role;
alter table public.tenant_slug_history enable row level security;
create policy "Anyone reads slug history" on public.tenant_slug_history for select to anon, authenticated using (true);

-- AUDIT LOG
create table public.audit_log (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references auth.users(id),
  actor_email citext,
  tenant_id uuid references public.tenants(id),
  tenant_slug citext,
  scope text not null,
  action text not null,
  resource_type text,
  resource_id text,
  context jsonb not null default '{}'::jsonb,
  prev_hash bytea,
  row_hash bytea not null,
  signature bytea,
  client_ip inet,
  user_agent text
);
create index audit_log_tenant_idx on public.audit_log(tenant_id);
create index audit_log_actor_idx on public.audit_log(actor_user_id);
create index audit_log_action_idx on public.audit_log(action);
create index audit_log_occurred_at_idx on public.audit_log(occurred_at);
grant select, insert on public.audit_log to authenticated;
grant all on public.audit_log to service_role;
alter table public.audit_log enable row level security;

create or replace function public.audit_log_chain()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_prev bytea; v_payload text;
begin
  select row_hash into v_prev from public.audit_log order by id desc limit 1;
  new.prev_hash := v_prev;
  new.actor_user_id := coalesce(new.actor_user_id, auth.uid());
  v_payload := coalesce(encode(v_prev,'hex'),'')||'|'||coalesce(new.actor_user_id::text,'')||'|'||
               coalesce(new.tenant_id::text,'')||'|'||new.scope||'|'||new.action||'|'||
               coalesce(new.resource_type,'')||'|'||coalesce(new.resource_id,'')||'|'||
               coalesce(new.context::text,'{}')||'|'||new.occurred_at::text;
  new.row_hash := digest(v_payload, 'sha256');
  return new;
end; $$;

create trigger audit_log_chain_trg before insert on public.audit_log
  for each row execute function public.audit_log_chain();

create or replace function public.audit_log_block_mutation()
returns trigger language plpgsql as $$
begin raise exception 'audit_log is append-only'; end; $$;

create trigger audit_log_no_update before update on public.audit_log
  for each row execute function public.audit_log_block_mutation();
create trigger audit_log_no_delete before delete on public.audit_log
  for each row execute function public.audit_log_block_mutation();

create policy "Platform admins read all audit" on public.audit_log for select to authenticated
  using (public.is_platform_admin(auth.uid()));
create policy "Tenant admins read tenant audit" on public.audit_log for select to authenticated
  using (tenant_id is not null and public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));
create policy "Users read own audit" on public.audit_log for select to authenticated using (actor_user_id = auth.uid());
create policy "Authenticated insert audit" on public.audit_log for insert to authenticated with check (true);

create or replace function public.verify_audit_chain(_limit int default 10000)
returns table (ok boolean, first_bad_id bigint)
language plpgsql security definer set search_path = public as $$
declare r record; v_prev bytea := null; v_expected bytea; v_payload text;
begin
  for r in (select * from public.audit_log order by id asc limit _limit) loop
    v_payload := coalesce(encode(v_prev,'hex'),'')||'|'||coalesce(r.actor_user_id::text,'')||'|'||
                 coalesce(r.tenant_id::text,'')||'|'||r.scope||'|'||r.action||'|'||
                 coalesce(r.resource_type,'')||'|'||coalesce(r.resource_id,'')||'|'||
                 coalesce(r.context::text,'{}')||'|'||r.occurred_at::text;
    v_expected := digest(v_payload, 'sha256');
    if v_expected <> r.row_hash or coalesce(r.prev_hash,''::bytea) <> coalesce(v_prev,''::bytea) then
      return query select false, r.id; return;
    end if;
    v_prev := r.row_hash;
  end loop;
  return query select true::boolean, null::bigint;
end; $$;

-- PROFILE BOOTSTRAP + first-admin seed
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_seed_email text;
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;

  begin v_seed_email := current_setting('app.platform_admin_seed_email', true);
  exception when others then v_seed_email := null; end;

  if v_seed_email is not null and lower(v_seed_email) = lower(new.email) then
    insert into public.platform_roles (user_id, role) values (new.id, 'platform_admin')
    on conflict do nothing;
  end if;
  return new;
end; $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at helper
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.tg_set_updated_at();
create trigger tenant_families_updated_at before update on public.tenant_families
  for each row execute function public.tg_set_updated_at();
create trigger tenants_updated_at before update on public.tenants
  for each row execute function public.tg_set_updated_at();
