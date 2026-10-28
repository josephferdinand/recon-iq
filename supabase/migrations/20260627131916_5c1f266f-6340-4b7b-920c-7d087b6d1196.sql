
CREATE TABLE public.recon_definition_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  asset_class text not null,
  title text not null,
  summary text,
  description text,
  legs jsonb not null default '[]'::jsonb,
  keys jsonb not null default '[]'::jsonb,
  tolerances jsonb not null default '{}'::jsonb,
  rules jsonb not null default '[]'::jsonb,
  sample_fields jsonb not null default '[]'::jsonb,
  tags text[] not null default '{}',
  status text not null default 'published' check (status in ('published','beta','draft')),
  install_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT ON public.recon_definition_templates TO authenticated;
GRANT ALL ON public.recon_definition_templates TO service_role;
ALTER TABLE public.recon_definition_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tpl read all" ON public.recon_definition_templates FOR SELECT TO authenticated USING (status = 'published');
CREATE POLICY "tpl admin write" ON public.recon_definition_templates FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER tg_recon_tpl_updated BEFORE UPDATE ON public.recon_definition_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.asset_class_presets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category text not null,           -- cash, securities, derivatives, collateral, payments, cards, custody, nav, ca
  ingestion_formats text[] not null default '{}',
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
GRANT SELECT ON public.asset_class_presets TO authenticated;
GRANT ALL ON public.asset_class_presets TO service_role;
ALTER TABLE public.asset_class_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "presets read all" ON public.asset_class_presets FOR SELECT TO authenticated USING (is_active);
CREATE POLICY "presets admin write" ON public.asset_class_presets FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE TABLE public.collateral_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  counterparty text not null,
  csa_id text,
  schedule_type text not null default 'VM' check (schedule_type in ('VM','IM','Triparty')),
  threshold_amount numeric(20,4) not null default 0,
  minimum_transfer numeric(20,4) not null default 0,
  rounding numeric(10,2) not null default 0,
  eligible_collateral_json jsonb not null default '[]'::jsonb,
  haircut_json jsonb not null default '{}'::jsonb,
  effective_from date,
  effective_to date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collateral_schedules TO authenticated;
GRANT ALL ON public.collateral_schedules TO service_role;
ALTER TABLE public.collateral_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "collat read" ON public.collateral_schedules FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "collat write" ON public.collateral_schedules FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));
CREATE TRIGGER tg_collat_updated BEFORE UPDATE ON public.collateral_schedules
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_collat_tenant ON public.collateral_schedules(tenant_id);
