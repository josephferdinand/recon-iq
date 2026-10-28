
-- ============================================================
-- Enterprise Identity & Security v2 — schema
-- Covers: CMEK/BYOK-KMS, field-level envelope encryption registry,
--         Private Link requests, WORM evidence ledger,
--         DLP policies + scan results, SAML JIT enhancements.
-- ============================================================

-- -------------------------------------------------------- ENUMS
do $$ begin
  create type public.kms_provider as enum ('aws_kms','azure_key_vault','gcp_kms','hashicorp_vault');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.kms_purpose as enum ('data_at_rest','backup','field_envelope','signing');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.kms_status as enum ('pending_verify','active','rotating','revoked','failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.data_classification as enum ('pii','pci','phi','secret','financial');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.private_link_status as enum ('requested','approved','provisioning','active','rejected','revoked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.dlp_action as enum ('allow','redact','quarantine','block');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.dlp_severity as enum ('info','low','medium','high','critical');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------- 1) KMS KEYS
create table if not exists public.tenant_kms_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider public.kms_provider not null,
  alias text not null,
  key_arn text not null,
  region text,
  purpose public.kms_purpose not null default 'data_at_rest',
  status public.kms_status not null default 'pending_verify',
  rotation_period_days integer not null default 365 check (rotation_period_days between 30 and 3650),
  last_rotated_at timestamptz,
  last_verified_at timestamptz,
  verification_error text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, alias)
);
grant select, insert, update, delete on public.tenant_kms_keys to authenticated;
grant all on public.tenant_kms_keys to service_role;
alter table public.tenant_kms_keys enable row level security;

create policy "kms keys: tenant admins read"
  on public.tenant_kms_keys for select to authenticated
  using (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      or public.is_platform_admin(auth.uid()));

create policy "kms keys: tenant admins write"
  on public.tenant_kms_keys for all to authenticated
  using (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      or public.is_platform_admin(auth.uid()))
  with check (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      or public.is_platform_admin(auth.uid()));

create trigger tg_tenant_kms_keys_updated
  before update on public.tenant_kms_keys
  for each row execute function public.tg_set_updated_at();

-- ------------------------------- 2) ENCRYPTED COLUMN REGISTRY
create table if not exists public.tenant_encrypted_columns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kek_id uuid not null references public.tenant_kms_keys(id) on delete restrict,
  table_name text not null,
  column_name text not null,
  classification public.data_classification not null,
  envelope_alg text not null default 'AES-256-GCM',
  enabled boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, table_name, column_name)
);
grant select, insert, update, delete on public.tenant_encrypted_columns to authenticated;
grant all on public.tenant_encrypted_columns to service_role;
alter table public.tenant_encrypted_columns enable row level security;

create policy "enc cols: tenant admin all"
  on public.tenant_encrypted_columns for all to authenticated
  using (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      or public.is_platform_admin(auth.uid()))
  with check (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      or public.is_platform_admin(auth.uid()));

create trigger tg_tenant_enc_cols_updated
  before update on public.tenant_encrypted_columns
  for each row execute function public.tg_set_updated_at();

-- ----------------------------- 3) PRIVATE LINK / VPC REQUESTS
create table if not exists public.tenant_private_link_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider public.kms_provider not null,             -- reused: aws/azure/gcp/etc.
  region text not null,
  customer_account_id text not null,
  vpc_id text,
  endpoint_id text,
  status public.private_link_status not null default 'requested',
  requested_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  activated_at timestamptz,
  rejection_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.tenant_private_link_requests to authenticated;
grant all on public.tenant_private_link_requests to service_role;
alter table public.tenant_private_link_requests enable row level security;

create policy "plink: tenant admin read own"
  on public.tenant_private_link_requests for select to authenticated
  using (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      or public.is_platform_admin(auth.uid()));

create policy "plink: tenant admin insert"
  on public.tenant_private_link_requests for insert to authenticated
  with check (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));

create policy "plink: platform admin update"
  on public.tenant_private_link_requests for update to authenticated
  using (public.is_platform_admin(auth.uid()))
  with check (public.is_platform_admin(auth.uid()));

create trigger tg_tenant_plink_updated
  before update on public.tenant_private_link_requests
  for each row execute function public.tg_set_updated_at();

-- --------------------------------- 4) WORM EVIDENCE LEDGER
create table if not exists public.worm_evidence_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  evidence_type text not null,         -- audit_export | run_artifact | signoff | break_resolution
  resource_type text,
  resource_id text,
  sha256 text not null,
  size_bytes bigint,
  object_url text,                     -- s3:// or https:// pointing to immutable bucket
  bucket_name text,
  object_lock_until timestamptz,       -- S3 Object Lock retention
  legal_hold boolean not null default false,
  prev_hash text,
  chain_hash text not null,
  recorded_by uuid references auth.users(id),
  recorded_at timestamptz not null default now()
);
grant select, insert on public.worm_evidence_ledger to authenticated;
grant all on public.worm_evidence_ledger to service_role;
alter table public.worm_evidence_ledger enable row level security;

-- Explicitly no UPDATE/DELETE policies → append-only at the RLS level.
create policy "worm: tenant read own"
  on public.worm_evidence_ledger for select to authenticated
  using (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      or public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst')
      or public.is_platform_admin(auth.uid()));

create policy "worm: tenant admin append"
  on public.worm_evidence_ledger for insert to authenticated
  with check (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      or public.is_platform_admin(auth.uid()));

-- Defence-in-depth: block UPDATE/DELETE even if a future policy is added.
create or replace function public.worm_ledger_immutable()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  raise exception 'WORM ledger is append-only';
end $$;
revoke execute on function public.worm_ledger_immutable() from public, anon, authenticated;

create trigger tg_worm_no_update
  before update on public.worm_evidence_ledger
  for each row execute function public.worm_ledger_immutable();

create trigger tg_worm_no_delete
  before delete on public.worm_evidence_ledger
  for each row execute function public.worm_ledger_immutable();

create index if not exists idx_worm_tenant_recorded
  on public.worm_evidence_ledger (tenant_id, recorded_at desc);

-- ---------------------------------------- 5) DLP POLICIES + SCANS
create table if not exists public.dlp_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  detect_pan boolean not null default true,        -- card numbers
  detect_iban boolean not null default true,
  detect_ssn boolean not null default true,
  detect_email boolean not null default false,
  detect_aba boolean not null default true,
  detect_swift_bic boolean not null default false,
  custom_patterns jsonb not null default '[]'::jsonb,
  default_action public.dlp_action not null default 'quarantine',
  block_on_high boolean not null default true,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id)
);
grant select, insert, update on public.dlp_policies to authenticated;
grant all on public.dlp_policies to service_role;
alter table public.dlp_policies enable row level security;

create policy "dlp policy: tenant admin all"
  on public.dlp_policies for all to authenticated
  using (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      or public.is_platform_admin(auth.uid()))
  with check (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      or public.is_platform_admin(auth.uid()));

create trigger tg_dlp_policies_updated
  before update on public.dlp_policies
  for each row execute function public.tg_set_updated_at();

create table if not exists public.dlp_scan_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_kind text not null,                       -- ingestion_file | break_attachment | message
  source_id text,
  filename text,
  scanner_version text not null default 'fvi-dlp-1.0',
  matches jsonb not null default '[]'::jsonb,      -- [{type,count,sample_redacted}]
  severity public.dlp_severity not null default 'info',
  action_taken public.dlp_action not null default 'allow',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  resolution text,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.dlp_scan_results to authenticated;
grant all on public.dlp_scan_results to service_role;
alter table public.dlp_scan_results enable row level security;

create policy "dlp scan: tenant read"
  on public.dlp_scan_results for select to authenticated
  using (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      or public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst')
      or public.is_platform_admin(auth.uid()));

create policy "dlp scan: tenant admin write"
  on public.dlp_scan_results for insert to authenticated
  with check (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      or public.is_platform_admin(auth.uid()));

create policy "dlp scan: tenant admin update"
  on public.dlp_scan_results for update to authenticated
  using (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      or public.is_platform_admin(auth.uid()))
  with check (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      or public.is_platform_admin(auth.uid()));

create index if not exists idx_dlp_scan_tenant_created
  on public.dlp_scan_results (tenant_id, created_at desc);

-- --------------------------- 6) SAML JIT enhancements
do $$ begin
  alter table public.tenant_sso_configs
    add column if not exists jit_provisioning boolean not null default false,
    add column if not exists default_role text,
    add column if not exists attribute_mapping jsonb not null default '{}'::jsonb;
exception when undefined_table then null; end $$;

-- ----------------------------- 7) WORM chain helper
create or replace function public.worm_append(
  _tenant_id uuid,
  _evidence_type text,
  _resource_type text,
  _resource_id text,
  _sha256 text,
  _size_bytes bigint,
  _object_url text,
  _bucket_name text,
  _retention_days integer
) returns public.worm_evidence_ledger
language plpgsql security definer set search_path = public as $$
declare
  _prev text;
  _chain text;
  _row public.worm_evidence_ledger;
begin
  if not (public.has_tenant_role(auth.uid(), _tenant_id, 'tenant_admin')
       or public.is_platform_admin(auth.uid())) then
    raise exception 'Forbidden: tenant_admin required';
  end if;
  select chain_hash into _prev
    from public.worm_evidence_ledger
   where tenant_id = _tenant_id
   order by recorded_at desc, id desc
   limit 1;
  _chain := encode(
    digest(coalesce(_prev,'') || '|' || _sha256 || '|' || _evidence_type
           || '|' || coalesce(_resource_id,''), 'sha256'),
    'hex');
  insert into public.worm_evidence_ledger
    (tenant_id, evidence_type, resource_type, resource_id, sha256, size_bytes,
     object_url, bucket_name, object_lock_until, prev_hash, chain_hash, recorded_by)
  values
    (_tenant_id, _evidence_type, _resource_type, _resource_id, _sha256, _size_bytes,
     _object_url, _bucket_name,
     case when _retention_days is null then null
          else now() + make_interval(days => _retention_days) end,
     _prev, _chain, auth.uid())
  returning * into _row;
  return _row;
end $$;
revoke execute on function public.worm_append(uuid,text,text,text,text,bigint,text,text,integer)
  from public, anon;
grant execute on function public.worm_append(uuid,text,text,text,text,bigint,text,text,integer)
  to authenticated;
