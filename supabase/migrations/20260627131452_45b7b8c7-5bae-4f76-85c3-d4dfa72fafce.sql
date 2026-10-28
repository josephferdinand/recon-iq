
-- ===================== DORA Article 28 =====================
CREATE TABLE public.dora_register (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider_name text not null,
  service_description text not null,
  criticality text not null default 'important' check (criticality in ('critical','important','non_critical')),
  data_processed text,
  country text,
  subcontractors_json jsonb not null default '[]'::jsonb,
  contract_start date,
  contract_end date,
  exit_plan_id uuid,
  last_review_at timestamptz,
  status text not null default 'active' check (status in ('active','retired','onboarding')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dora_register TO authenticated;
GRANT ALL ON public.dora_register TO service_role;
ALTER TABLE public.dora_register ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dora_register tenant read" ON public.dora_register FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "dora_register tenant write" ON public.dora_register FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));
CREATE TRIGGER tg_dora_register_updated BEFORE UPDATE ON public.dora_register
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_dora_register_tenant ON public.dora_register(tenant_id);

CREATE TABLE public.dora_exit_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  register_id uuid references public.dora_register(id) on delete cascade,
  title text not null,
  trigger_conditions text,
  steps_json jsonb not null default '[]'::jsonb,
  rto_hours int not null default 24,
  rpo_minutes int not null default 60,
  last_tested_at timestamptz,
  status text not null default 'draft' check (status in ('draft','approved','tested','expired')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dora_exit_plans TO authenticated;
GRANT ALL ON public.dora_exit_plans TO service_role;
ALTER TABLE public.dora_exit_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dora_exit_plans tenant read" ON public.dora_exit_plans FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "dora_exit_plans tenant write" ON public.dora_exit_plans FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));
CREATE TRIGGER tg_dora_exit_plans_updated BEFORE UPDATE ON public.dora_exit_plans
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.dora_incidents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  detected_at timestamptz,
  resolved_at timestamptz,
  classification text not null default 'major' check (classification in ('major','significant','minor')),
  root_cause text,
  impacted_services_json jsonb not null default '[]'::jsonb,
  customers_affected int,
  reported_to_regulator boolean not null default false,
  regulator_ref text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dora_incidents TO authenticated;
GRANT ALL ON public.dora_incidents TO service_role;
ALTER TABLE public.dora_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dora_incidents tenant read" ON public.dora_incidents FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "dora_incidents tenant write" ON public.dora_incidents FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));
CREATE TRIGGER tg_dora_incidents_updated BEFORE UPDATE ON public.dora_incidents
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ===================== Data Lineage (BCBS 239 / FRTB / IFRS 9) =====================
CREATE TABLE public.data_lineage_edges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_kind text not null,        -- e.g. 'data_source','pipeline','recon','report','ledger'
  source_ref text not null,
  source_label text,
  target_kind text not null,
  target_ref text not null,
  target_label text,
  transform text,                   -- description of the transform
  attributes jsonb not null default '{}'::jsonb,
  evidence_hash text,
  recorded_at timestamptz not null default now(),
  recorded_by uuid references auth.users(id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_lineage_edges TO authenticated;
GRANT ALL ON public.data_lineage_edges TO service_role;
ALTER TABLE public.data_lineage_edges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lineage tenant read" ON public.data_lineage_edges FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "lineage tenant write" ON public.data_lineage_edges FOR ALL TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE INDEX idx_lineage_tenant ON public.data_lineage_edges(tenant_id, recorded_at DESC);
CREATE INDEX idx_lineage_source ON public.data_lineage_edges(tenant_id, source_kind, source_ref);
CREATE INDEX idx_lineage_target ON public.data_lineage_edges(tenant_id, target_kind, target_ref);
