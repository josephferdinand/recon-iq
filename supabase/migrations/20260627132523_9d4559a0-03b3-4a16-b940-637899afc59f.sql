
CREATE TABLE public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  prefix text not null,                   -- first 8 chars for display (e.g. fvi_ab12)
  token_hash text not null,               -- sha256 of full token
  scopes text[] not null default '{}',    -- e.g. recon.read, ingest.write, exceptions.update
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_tokens TO authenticated;
GRANT ALL ON public.api_tokens TO service_role;
ALTER TABLE public.api_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tok read" ON public.api_tokens FOR SELECT TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));
CREATE POLICY "tok write" ON public.api_tokens FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));
CREATE INDEX idx_apitok_tenant ON public.api_tokens(tenant_id);
CREATE INDEX idx_apitok_hash ON public.api_tokens(token_hash);

CREATE TABLE public.recon_definition_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  recon_definition_id uuid not null references public.recon_definitions(id) on delete cascade,
  version_number int not null,
  message text,
  snapshot jsonb not null,
  diff jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(recon_definition_id, version_number)
);
GRANT SELECT, INSERT ON public.recon_definition_versions TO authenticated;
GRANT ALL ON public.recon_definition_versions TO service_role;
ALTER TABLE public.recon_definition_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rdv read" ON public.recon_definition_versions FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "rdv write" ON public.recon_definition_versions FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));
CREATE INDEX idx_rdv_def ON public.recon_definition_versions(recon_definition_id, version_number DESC);

CREATE TABLE public.migration_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_system text not null check (source_system in ('duco','tlm','smartstream','frontier','intellimatch','custom')),
  file_name text,
  status text not null default 'pending' check (status in ('pending','parsing','mapped','imported','failed')),
  definitions_found int not null default 0,
  definitions_imported int not null default 0,
  mapping_report jsonb not null default '{}'::jsonb,
  error_message text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.migration_imports TO authenticated;
GRANT ALL ON public.migration_imports TO service_role;
ALTER TABLE public.migration_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mig read" ON public.migration_imports FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "mig write" ON public.migration_imports FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));
CREATE TRIGGER tg_mig_updated BEFORE UPDATE ON public.migration_imports FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.synthetic_data_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  preset_code text not null,             -- e.g. tpl-fx-confirms
  rows_per_side int not null default 1000,
  break_rate_pct numeric(5,2) not null default 5.0,
  seed bigint not null default 42,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  result_summary jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.synthetic_data_jobs TO authenticated;
GRANT ALL ON public.synthetic_data_jobs TO service_role;
ALTER TABLE public.synthetic_data_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "synth read" ON public.synthetic_data_jobs FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "synth write" ON public.synthetic_data_jobs FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));

CREATE TABLE public.chat_ops_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  platform text not null check (platform in ('teams','slack')),
  channel text not null,
  webhook_url text not null,
  events text[] not null default '{break.new,break.assigned,break.closed,run.failed}',
  enabled boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_ops_subscriptions TO authenticated;
GRANT ALL ON public.chat_ops_subscriptions TO service_role;
ALTER TABLE public.chat_ops_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat read" ON public.chat_ops_subscriptions FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "chat write" ON public.chat_ops_subscriptions FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));
