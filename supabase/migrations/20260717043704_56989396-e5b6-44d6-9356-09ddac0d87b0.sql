
-- =====================================================================
-- Template Marketplace & Industry Template Gallery
-- =====================================================================

DO $$ BEGIN CREATE TYPE public.mkt_tpl_pack_type AS ENUM ('featured','regulatory','industry','pack','community','internal'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.mkt_tpl_certification AS ENUM ('draft','review','approved','certified','deprecated','archived'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.mkt_tpl_visibility AS ENUM ('public','restricted','private'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.mkt_tpl_license AS ENUM ('free','trial','paid','enterprise'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.mkt_tpl_version_status AS ENUM ('draft','review','approved','published','deprecated','archived'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.mkt_install_state AS ENUM ('installed','active','paused','uninstalled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- HELPER FUNCTIONS ----------
CREATE OR REPLACE FUNCTION public.mkt_is_tenant_admin(_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = _tenant_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'tenant_admin'::public.tenant_role
  ) OR public.is_platform_admin(auth.uid());
$$;
REVOKE ALL ON FUNCTION public.mkt_is_tenant_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mkt_is_tenant_admin(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mkt_is_workspace_admin(_workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = _workspace_id
      AND wm.user_id = auth.uid()
      AND wm.role IN ('owner','admin','workspace_admin')
  ) OR public.is_platform_admin(auth.uid());
$$;
REVOKE ALL ON FUNCTION public.mkt_is_workspace_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mkt_is_workspace_admin(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mkt_is_tenant_member(_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = _tenant_id AND tm.user_id = auth.uid()
  ) OR public.is_platform_admin(auth.uid());
$$;
REVOKE ALL ON FUNCTION public.mkt_is_tenant_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mkt_is_tenant_member(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mkt_is_workspace_member(_workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = _workspace_id AND wm.user_id = auth.uid()
  ) OR public.is_platform_admin(auth.uid());
$$;
REVOKE ALL ON FUNCTION public.mkt_is_workspace_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mkt_is_workspace_member(uuid) TO authenticated, service_role;

-- ---------- CATEGORIES ----------
CREATE TABLE IF NOT EXISTS public.mkt_template_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  parent_id uuid REFERENCES public.mkt_template_categories(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('industry','regulator','region','pack')),
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.mkt_template_categories TO authenticated;
GRANT ALL ON public.mkt_template_categories TO service_role;
ALTER TABLE public.mkt_template_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mkt_cat_read" ON public.mkt_template_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "mkt_cat_write_platform" ON public.mkt_template_categories FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

-- ---------- TEMPLATES ----------
CREATE TABLE IF NOT EXISTS public.mkt_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  summary text,
  description text,
  pack_type public.mkt_tpl_pack_type NOT NULL DEFAULT 'industry',
  certification public.mkt_tpl_certification NOT NULL DEFAULT 'draft',
  visibility public.mkt_tpl_visibility NOT NULL DEFAULT 'restricted',
  license public.mkt_tpl_license NOT NULL DEFAULT 'free',
  min_plan text,
  industries text[] NOT NULL DEFAULT '{}',
  regions text[] NOT NULL DEFAULT '{}',
  standards text[] NOT NULL DEFAULT '{}',
  tags text[] NOT NULL DEFAULT '{}',
  category_id uuid REFERENCES public.mkt_template_categories(id) ON DELETE SET NULL,
  publisher_user_id uuid,
  current_version_id uuid,
  install_count int NOT NULL DEFAULT 0,
  avg_rating numeric(3,2) NOT NULL DEFAULT 0,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mkt_templates TO authenticated;
GRANT ALL ON public.mkt_templates TO service_role;
ALTER TABLE public.mkt_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mkt_tpl_read_public" ON public.mkt_templates FOR SELECT TO authenticated
USING (public.is_platform_admin(auth.uid())
  OR (certification IN ('approved','certified') AND retired_at IS NULL AND visibility IN ('public','restricted')));
CREATE POLICY "mkt_tpl_write_platform" ON public.mkt_templates FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE POLICY "mkt_tpl_update_platform" ON public.mkt_templates FOR UPDATE TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE POLICY "mkt_tpl_delete_platform" ON public.mkt_templates FOR DELETE TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- ---------- VERSIONS ----------
CREATE TABLE IF NOT EXISTS public.mkt_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.mkt_templates(id) ON DELETE CASCADE,
  semver text NOT NULL,
  status public.mkt_tpl_version_status NOT NULL DEFAULT 'draft',
  spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  changelog text,
  authored_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  published_by uuid,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, semver)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mkt_template_versions TO authenticated;
GRANT ALL ON public.mkt_template_versions TO service_role;
ALTER TABLE public.mkt_template_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mkt_ver_read" ON public.mkt_template_versions FOR SELECT TO authenticated
USING (public.is_platform_admin(auth.uid())
  OR EXISTS (SELECT 1 FROM public.mkt_templates t WHERE t.id = template_id
    AND t.certification IN ('approved','certified') AND t.retired_at IS NULL AND status = 'published'));
CREATE POLICY "mkt_ver_write_platform" ON public.mkt_template_versions FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE POLICY "mkt_ver_update_platform" ON public.mkt_template_versions FOR UPDATE TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()) AND (approved_by IS NULL OR approved_by <> authored_by));
CREATE POLICY "mkt_ver_delete_platform" ON public.mkt_template_versions FOR DELETE TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- ---------- ELIGIBILITY ----------
CREATE TABLE IF NOT EXISTS public.mkt_template_eligibility (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.mkt_templates(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  region text,
  industry text,
  plan_tier text,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mkt_template_eligibility TO authenticated;
GRANT ALL ON public.mkt_template_eligibility TO service_role;
ALTER TABLE public.mkt_template_eligibility ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mkt_elig_read" ON public.mkt_template_eligibility FOR SELECT TO authenticated
USING (public.is_platform_admin(auth.uid()) OR (tenant_id IS NOT NULL AND public.mkt_is_tenant_admin(tenant_id)));
CREATE POLICY "mkt_elig_write_platform" ON public.mkt_template_eligibility FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

-- ---------- REVIEWS ----------
CREATE TABLE IF NOT EXISTS public.mkt_template_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.mkt_templates(id) ON DELETE CASCADE,
  version_id uuid REFERENCES public.mkt_template_versions(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approve','reject','request_changes')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.mkt_template_reviews TO authenticated;
GRANT ALL ON public.mkt_template_reviews TO service_role;
ALTER TABLE public.mkt_template_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mkt_rev_read_platform" ON public.mkt_template_reviews FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));
CREATE POLICY "mkt_rev_write_platform" ON public.mkt_template_reviews FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin(auth.uid()) AND reviewer_id = auth.uid());

-- ---------- RATINGS ----------
CREATE TABLE IF NOT EXISTS public.mkt_template_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.mkt_templates(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  stars int NOT NULL CHECK (stars BETWEEN 1 AND 5),
  review text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, tenant_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mkt_template_ratings TO authenticated;
GRANT ALL ON public.mkt_template_ratings TO service_role;
ALTER TABLE public.mkt_template_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mkt_rat_read" ON public.mkt_template_ratings FOR SELECT TO authenticated USING (true);
CREATE POLICY "mkt_rat_write_own" ON public.mkt_template_ratings FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.mkt_is_tenant_admin(tenant_id));
CREATE POLICY "mkt_rat_update_own" ON public.mkt_template_ratings FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "mkt_rat_delete_own" ON public.mkt_template_ratings FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

-- ---------- INSTALLS ----------
CREATE TABLE IF NOT EXISTS public.tenant_template_installs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.mkt_templates(id) ON DELETE RESTRICT,
  installed_version_id uuid REFERENCES public.mkt_template_versions(id) ON DELETE SET NULL,
  state public.mkt_install_state NOT NULL DEFAULT 'installed',
  auto_update boolean NOT NULL DEFAULT false,
  installed_by uuid,
  installed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, template_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_template_installs TO authenticated;
GRANT ALL ON public.tenant_template_installs TO service_role;
ALTER TABLE public.tenant_template_installs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tti_read" ON public.tenant_template_installs FOR SELECT TO authenticated
USING (public.mkt_is_tenant_admin(tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "tti_write" ON public.tenant_template_installs FOR INSERT TO authenticated
  WITH CHECK (public.mkt_is_tenant_admin(tenant_id));
CREATE POLICY "tti_update" ON public.tenant_template_installs FOR UPDATE TO authenticated
  USING (public.mkt_is_tenant_admin(tenant_id)) WITH CHECK (public.mkt_is_tenant_admin(tenant_id));
CREATE POLICY "tti_delete" ON public.tenant_template_installs FOR DELETE TO authenticated
  USING (public.mkt_is_tenant_admin(tenant_id));

-- ---------- TENANT TEMPLATES ----------
CREATE TABLE IF NOT EXISTS public.tenant_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_install_id uuid REFERENCES public.tenant_template_installs(id) ON DELETE SET NULL,
  source_template_id uuid REFERENCES public.mkt_templates(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_semver text NOT NULL DEFAULT '1.0.0',
  status public.mkt_tpl_version_status NOT NULL DEFAULT 'draft',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_templates TO authenticated;
GRANT ALL ON public.tenant_templates TO service_role;
ALTER TABLE public.tenant_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tt_read" ON public.tenant_templates FOR SELECT TO authenticated
USING (public.mkt_is_tenant_member(tenant_id));
CREATE POLICY "tt_write" ON public.tenant_templates FOR INSERT TO authenticated
  WITH CHECK (public.mkt_is_tenant_admin(tenant_id));
CREATE POLICY "tt_update" ON public.tenant_templates FOR UPDATE TO authenticated
  USING (public.mkt_is_tenant_admin(tenant_id)) WITH CHECK (public.mkt_is_tenant_admin(tenant_id));
CREATE POLICY "tt_delete" ON public.tenant_templates FOR DELETE TO authenticated
  USING (public.mkt_is_tenant_admin(tenant_id));

CREATE TABLE IF NOT EXISTS public.tenant_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_template_id uuid NOT NULL REFERENCES public.tenant_templates(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  semver text NOT NULL,
  spec jsonb NOT NULL,
  changelog text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_template_id, semver)
);
GRANT SELECT, INSERT ON public.tenant_template_versions TO authenticated;
GRANT ALL ON public.tenant_template_versions TO service_role;
ALTER TABLE public.tenant_template_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ttv_read" ON public.tenant_template_versions FOR SELECT TO authenticated
USING (public.mkt_is_tenant_admin(tenant_id));
CREATE POLICY "ttv_write" ON public.tenant_template_versions FOR INSERT TO authenticated
  WITH CHECK (public.mkt_is_tenant_admin(tenant_id));

-- ---------- WORKSPACE ASSIGNMENTS ----------
CREATE TABLE IF NOT EXISTS public.workspace_template_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  tenant_template_id uuid NOT NULL REFERENCES public.tenant_templates(id) ON DELETE CASCADE,
  team_ids uuid[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  permission text NOT NULL DEFAULT 'use' CHECK (permission IN ('view','use','admin')),
  field_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, tenant_template_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_template_assignments TO authenticated;
GRANT ALL ON public.workspace_template_assignments TO service_role;
ALTER TABLE public.workspace_template_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wta_read" ON public.workspace_template_assignments FOR SELECT TO authenticated
USING (public.mkt_is_workspace_member(workspace_id));
CREATE POLICY "wta_write" ON public.workspace_template_assignments FOR INSERT TO authenticated
  WITH CHECK (public.mkt_is_workspace_admin(workspace_id));
CREATE POLICY "wta_update" ON public.workspace_template_assignments FOR UPDATE TO authenticated
  USING (public.mkt_is_workspace_admin(workspace_id)) WITH CHECK (public.mkt_is_workspace_admin(workspace_id));
CREATE POLICY "wta_delete" ON public.workspace_template_assignments FOR DELETE TO authenticated
  USING (public.mkt_is_workspace_admin(workspace_id));

CREATE TABLE IF NOT EXISTS public.workspace_template_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  tenant_template_id uuid NOT NULL REFERENCES public.tenant_templates(id) ON DELETE CASCADE,
  used_by uuid,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.workspace_template_usage TO authenticated;
GRANT ALL ON public.workspace_template_usage TO service_role;
ALTER TABLE public.workspace_template_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wtu_read" ON public.workspace_template_usage FOR SELECT TO authenticated
USING (public.mkt_is_workspace_admin(workspace_id));
CREATE POLICY "wtu_write" ON public.workspace_template_usage FOR INSERT TO authenticated
  WITH CHECK (used_by = auth.uid() AND public.mkt_is_workspace_member(workspace_id));

-- ---------- AI SUGGESTIONS ----------
CREATE TABLE IF NOT EXISTS public.mkt_template_ai_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('recommend','gap','regulator','nl_prompt','automap')),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  llm_provider_instance_id uuid,
  llm_model text,
  accepted_by uuid,
  accepted_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.mkt_template_ai_suggestions TO authenticated;
GRANT ALL ON public.mkt_template_ai_suggestions TO service_role;
ALTER TABLE public.mkt_template_ai_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mkt_ais_read" ON public.mkt_template_ai_suggestions FOR SELECT TO authenticated
USING (public.is_platform_admin(auth.uid()) OR (tenant_id IS NOT NULL AND public.mkt_is_tenant_admin(tenant_id)));
CREATE POLICY "mkt_ais_write" ON public.mkt_template_ai_suggestions FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND (tenant_id IS NULL OR public.mkt_is_tenant_admin(tenant_id)));
CREATE POLICY "mkt_ais_update_own" ON public.mkt_template_ai_suggestions FOR UPDATE TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR (tenant_id IS NOT NULL AND public.mkt_is_tenant_admin(tenant_id)));

-- ---------- AUDIT LOG (WORM) ----------
CREATE TABLE IF NOT EXISTS public.mkt_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  correlation_id uuid,
  ip inet,
  user_agent text,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.mkt_audit_log TO authenticated;
GRANT ALL ON public.mkt_audit_log TO service_role;
ALTER TABLE public.mkt_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mkt_audit_read" ON public.mkt_audit_log FOR SELECT TO authenticated
USING (public.is_platform_admin(auth.uid())
  OR (tenant_id IS NOT NULL AND public.mkt_is_tenant_admin(tenant_id))
  OR (workspace_id IS NOT NULL AND public.mkt_is_workspace_admin(workspace_id)));
CREATE POLICY "mkt_audit_write" ON public.mkt_audit_log FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_mkt_audit_tenant ON public.mkt_audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mkt_audit_entity ON public.mkt_audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mkt_tpl_certification ON public.mkt_templates(certification, retired_at);
CREATE INDEX IF NOT EXISTS idx_mkt_tpl_pack_type ON public.mkt_templates(pack_type);
CREATE INDEX IF NOT EXISTS idx_mkt_tpl_industries ON public.mkt_templates USING GIN (industries);
CREATE INDEX IF NOT EXISTS idx_mkt_tpl_regions ON public.mkt_templates USING GIN (regions);
CREATE INDEX IF NOT EXISTS idx_mkt_tpl_standards ON public.mkt_templates USING GIN (standards);
CREATE INDEX IF NOT EXISTS idx_tti_tenant ON public.tenant_template_installs(tenant_id);

-- ---------- TOUCH TRIGGER ----------
CREATE OR REPLACE FUNCTION public.mkt_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_mkt_templates_updated ON public.mkt_templates;
CREATE TRIGGER trg_mkt_templates_updated BEFORE UPDATE ON public.mkt_templates
  FOR EACH ROW EXECUTE FUNCTION public.mkt_touch_updated_at();
DROP TRIGGER IF EXISTS trg_mkt_versions_updated ON public.mkt_template_versions;
CREATE TRIGGER trg_mkt_versions_updated BEFORE UPDATE ON public.mkt_template_versions
  FOR EACH ROW EXECUTE FUNCTION public.mkt_touch_updated_at();
DROP TRIGGER IF EXISTS trg_tt_updated ON public.tenant_templates;
CREATE TRIGGER trg_tt_updated BEFORE UPDATE ON public.tenant_templates
  FOR EACH ROW EXECUTE FUNCTION public.mkt_touch_updated_at();
DROP TRIGGER IF EXISTS trg_tti_updated ON public.tenant_template_installs;
CREATE TRIGGER trg_tti_updated BEFORE UPDATE ON public.tenant_template_installs
  FOR EACH ROW EXECUTE FUNCTION public.mkt_touch_updated_at();

-- ---------- SEED CATEGORIES ----------
INSERT INTO public.mkt_template_categories (slug, name, kind, sort_order) VALUES
  ('banking','Banking & Financial Services','industry',10),
  ('capital-markets','Capital Markets','industry',20),
  ('insurance','Insurance','industry',30),
  ('payments','Payments & FinTech','industry',40),
  ('healthcare','Healthcare','industry',50),
  ('retail','Retail & Commerce','industry',60),
  ('manufacturing','Manufacturing','industry',70),
  ('government','Government & Public Sector','industry',80),
  ('reg-us','United States Regulators','regulator',110),
  ('reg-uk','United Kingdom Regulators','regulator',120),
  ('reg-eu','European Union Regulators','regulator',130),
  ('reg-apac','APAC Regulators','regulator',140),
  ('reg-me','Middle East Regulators','regulator',150),
  ('reg-global','Global Standards','regulator',160),
  ('pack-fs','Financial Services Pack','pack',200),
  ('pack-payments','Payments Pack','pack',210)
ON CONFLICT (slug) DO NOTHING;

-- ---------- SEED TEMPLATES ----------
DO $$
DECLARE
  v_template_id uuid;
  v_version_id uuid;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('bank-reconciliation','Bank Reconciliation','Match bank statements to GL cash accounts.','industry','banking',ARRAY['banking'],ARRAY['global'],ARRAY['IFRS','GAAP']),
      ('cash-reconciliation','Cash Reconciliation','Daily cash position reconciliation across accounts.','industry','banking',ARRAY['banking'],ARRAY['global'],ARRAY['IFRS']),
      ('nostro-reconciliation','Nostro Reconciliation','Nostro account reconciliation for correspondent banking.','industry','banking',ARRAY['banking'],ARRAY['global'],ARRAY['SWIFT','ISO20022']),
      ('vostro-reconciliation','Vostro Reconciliation','Vostro account reconciliation.','industry','banking',ARRAY['banking'],ARRAY['global'],ARRAY['SWIFT','ISO20022']),
      ('swift-reconciliation','SWIFT Reconciliation','SWIFT MT/MX message-level reconciliation.','industry','banking',ARRAY['banking'],ARRAY['global'],ARRAY['SWIFT','ISO20022']),
      ('gl-reconciliation','General Ledger Reconciliation','Sub-ledger to GL reconciliation with tolerance.','industry','banking',ARRAY['banking'],ARRAY['global'],ARRAY['IFRS','GAAP','SOX']),
      ('treasury-reconciliation','Treasury Reconciliation','Treasury front-to-back office reconciliation.','industry','banking',ARRAY['banking'],ARRAY['global'],ARRAY['Basel III']),
      ('securities-reconciliation','Securities Reconciliation','Securities position and cash reconciliation.','industry','banking',ARRAY['banking','capital-markets'],ARRAY['global'],ARRAY['ISO20022']),
      ('intercompany-reconciliation','Intercompany Reconciliation','Intercompany elimination and matching.','industry','banking',ARRAY['banking'],ARRAY['global'],ARRAY['IFRS','GAAP']),
      ('card-settlement-recon','Card Settlement Reconciliation','Card scheme settlement reconciliation.','industry','banking',ARRAY['banking','payments'],ARRAY['global'],ARRAY['PCI-DSS']),
      ('atm-reconciliation','ATM Reconciliation','ATM cash and transaction reconciliation.','industry','banking',ARRAY['banking'],ARRAY['global'],ARRAY['PCI-DSS']),
      ('trade-reconciliation','Trade Reconciliation','Trade capture vs confirmation reconciliation.','industry','capital-markets',ARRAY['capital-markets'],ARRAY['global'],ARRAY['MiFID II','Dodd-Frank']),
      ('position-reconciliation','Position Reconciliation','Position reconciliation vs custodian.','industry','capital-markets',ARRAY['capital-markets'],ARRAY['global'],ARRAY['MiFID II']),
      ('custody-reconciliation','Custody Reconciliation','Custody holdings reconciliation.','industry','capital-markets',ARRAY['capital-markets'],ARRAY['global'],ARRAY['SEC','FINRA']),
      ('portfolio-reconciliation','Portfolio Reconciliation','Portfolio-level reconciliation for asset managers.','industry','capital-markets',ARRAY['capital-markets'],ARRAY['global'],ARRAY['MiFID II']),
      ('clearing-reconciliation','Clearing Reconciliation','CCP clearing member reconciliation.','industry','capital-markets',ARRAY['capital-markets'],ARRAY['global'],ARRAY['EMIR','Dodd-Frank']),
      ('settlement-reconciliation','Settlement Reconciliation','T+1/T+2 settlement reconciliation.','industry','capital-markets',ARRAY['capital-markets'],ARRAY['global'],ARRAY['ESMA','SEC']),
      ('premium-reconciliation','Premium Reconciliation','Premium bordereau reconciliation.','industry','insurance',ARRAY['insurance'],ARRAY['global'],ARRAY['Solvency II','IFRS 17']),
      ('claims-reconciliation','Claims Reconciliation','Insurance claims payment reconciliation.','industry','insurance',ARRAY['insurance'],ARRAY['global'],ARRAY['Solvency II','IFRS 17']),
      ('reinsurance-reconciliation','Reinsurance Reconciliation','Reinsurance treaty and cession reconciliation.','industry','insurance',ARRAY['insurance'],ARRAY['global'],ARRAY['Solvency II']),
      ('broker-reconciliation','Broker Reconciliation','Broker statement reconciliation.','industry','insurance',ARRAY['insurance'],ARRAY['global'],ARRAY['NAIC']),
      ('psp-reconciliation','PSP Reconciliation','Payment Service Provider reconciliation.','industry','payments',ARRAY['payments'],ARRAY['global'],ARRAY['PCI-DSS','PSD2']),
      ('gateway-reconciliation','Payment Gateway Reconciliation','Gateway settlement vs bank credits.','industry','payments',ARRAY['payments'],ARRAY['global'],ARRAY['PCI-DSS']),
      ('merchant-settlement-recon','Merchant Settlement Reconciliation','Merchant acquirer settlement reconciliation.','industry','payments',ARRAY['payments'],ARRAY['global'],ARRAY['PCI-DSS']),
      ('wallet-reconciliation','Wallet Reconciliation','Digital wallet ledger reconciliation.','industry','payments',ARRAY['payments'],ARRAY['global'],ARRAY['PSD2','Open Banking']),
      ('healthcare-claims-recon','Healthcare Claims Reconciliation','Provider vs payer claims reconciliation.','industry','healthcare',ARRAY['healthcare'],ARRAY['us'],ARRAY['HIPAA','Medicare']),
      ('provider-settlement-recon','Provider Settlement Reconciliation','Provider remittance reconciliation.','industry','healthcare',ARRAY['healthcare'],ARRAY['us','uk'],ARRAY['HIPAA','NHS']),
      ('member-billing-recon','Member Billing Reconciliation','Health plan member billing reconciliation.','industry','healthcare',ARRAY['healthcare'],ARRAY['global'],ARRAY['HIPAA']),
      ('pos-reconciliation','POS Reconciliation','POS terminal vs settlement reconciliation.','industry','retail',ARRAY['retail'],ARRAY['global'],ARRAY['PCI-DSS']),
      ('marketplace-reconciliation','Marketplace Reconciliation','Amazon/Shopify marketplace payout reconciliation.','industry','retail',ARRAY['retail'],ARRAY['global'],ARRAY['PCI-DSS']),
      ('refund-reconciliation','Refund Reconciliation','Refund and chargeback reconciliation.','industry','retail',ARRAY['retail'],ARRAY['global'],ARRAY['PCI-DSS']),
      ('inventory-reconciliation','Inventory Reconciliation','Inventory movement reconciliation.','industry','retail',ARRAY['retail','manufacturing'],ARRAY['global'],ARRAY[]::text[]),
      ('vendor-reconciliation','Vendor Reconciliation','AP vendor statement reconciliation.','industry','manufacturing',ARRAY['manufacturing'],ARRAY['global'],ARRAY['IFRS','GAAP']),
      ('procurement-reconciliation','Procurement Reconciliation','3-way match reconciliation.','industry','manufacturing',ARRAY['manufacturing'],ARRAY['global'],ARRAY['SOX']),
      ('supply-chain-reconciliation','Supply Chain Reconciliation','Inbound/outbound logistics reconciliation.','industry','manufacturing',ARRAY['manufacturing'],ARRAY['global'],ARRAY[]::text[]),
      ('gov-treasury-recon','Government Treasury Reconciliation','Consolidated fund treasury reconciliation.','industry','government',ARRAY['government'],ARRAY['global'],ARRAY['IPSAS']),
      ('grant-reconciliation','Grant Reconciliation','Grant disbursement reconciliation.','industry','government',ARRAY['government'],ARRAY['global'],ARRAY['IPSAS']),
      ('budget-reconciliation','Budget Reconciliation','Budget vs actual reconciliation.','industry','government',ARRAY['government'],ARRAY['global'],ARRAY['IPSAS']),
      ('reg-sec-pack','SEC Rule 17a-13 Pack','Quarterly securities count reconciliation for SEC broker-dealers.','regulatory','reg-us',ARRAY['capital-markets'],ARRAY['us'],ARRAY['SEC','FINRA']),
      ('reg-finra-pack','FINRA Reserve Formula Pack','15c3-3 reserve reconciliation.','regulatory','reg-us',ARRAY['capital-markets'],ARRAY['us'],ARRAY['FINRA']),
      ('reg-fed-pack','Federal Reserve FR Y-14 Pack','FR Y-14 data reconciliation.','regulatory','reg-us',ARRAY['banking'],ARRAY['us'],ARRAY['Federal Reserve']),
      ('reg-occ-pack','OCC Heightened Standards Pack','OCC reconciliation controls.','regulatory','reg-us',ARRAY['banking'],ARRAY['us'],ARRAY['OCC']),
      ('reg-irs-pack','IRS Withholding Reconciliation Pack','1042/1099 withholding reconciliation.','regulatory','reg-us',ARRAY['banking'],ARRAY['us'],ARRAY['IRS','FATCA']),
      ('reg-fca-pack','FCA CASS Pack','Client Assets Sourcebook reconciliation.','regulatory','reg-uk',ARRAY['banking','capital-markets'],ARRAY['uk'],ARRAY['FCA']),
      ('reg-pra-pack','PRA Regulatory Reporting Pack','PRA110 liquidity reconciliation.','regulatory','reg-uk',ARRAY['banking'],ARRAY['uk'],ARRAY['PRA']),
      ('reg-hmrc-pack','HMRC VAT/CT Reconciliation Pack','VAT return and corporation tax reconciliation.','regulatory','reg-uk',ARRAY['banking','retail'],ARRAY['uk'],ARRAY['HMRC']),
      ('reg-esma-pack','ESMA EMIR Reporting Pack','EMIR trade repository reconciliation.','regulatory','reg-eu',ARRAY['capital-markets'],ARRAY['eu'],ARRAY['ESMA','EMIR']),
      ('reg-eba-pack','EBA FINREP/COREP Pack','FINREP/COREP data reconciliation.','regulatory','reg-eu',ARRAY['banking'],ARRAY['eu'],ARRAY['EBA','Basel III']),
      ('reg-ecb-pack','ECB AnaCredit Pack','AnaCredit granular credit reconciliation.','regulatory','reg-eu',ARRAY['banking'],ARRAY['eu'],ARRAY['ECB']),
      ('reg-eiopa-pack','EIOPA Solvency II Pack','Solvency II QRT reconciliation.','regulatory','reg-eu',ARRAY['insurance'],ARRAY['eu'],ARRAY['EIOPA','Solvency II']),
      ('reg-apra-pack','APRA Reporting Pack','APRA ARF reconciliation.','regulatory','reg-apac',ARRAY['banking'],ARRAY['au'],ARRAY['APRA']),
      ('reg-asic-pack','ASIC RG97 Pack','Fee/cost reconciliation.','regulatory','reg-apac',ARRAY['capital-markets'],ARRAY['au'],ARRAY['ASIC']),
      ('reg-ato-pack','ATO GST/BAS Pack','GST reconciliation.','regulatory','reg-apac',ARRAY['retail'],ARRAY['au'],ARRAY['ATO']),
      ('reg-rbi-pack','RBI Returns Pack','RBI regulatory return reconciliation.','regulatory','reg-apac',ARRAY['banking'],ARRAY['in'],ARRAY['RBI']),
      ('reg-sebi-pack','SEBI Compliance Pack','SEBI broker reconciliation.','regulatory','reg-apac',ARRAY['capital-markets'],ARRAY['in'],ARRAY['SEBI']),
      ('reg-irdai-pack','IRDAI Compliance Pack','IRDAI insurance reconciliation.','regulatory','reg-apac',ARRAY['insurance'],ARRAY['in'],ARRAY['IRDAI']),
      ('reg-pfrda-pack','PFRDA NPS Pack','NPS reconciliation.','regulatory','reg-apac',ARRAY['insurance'],ARRAY['in'],ARRAY['PFRDA']),
      ('reg-gstn-pack','GSTN India GST Pack','GSTR-1/2/3B reconciliation.','regulatory','reg-apac',ARRAY['retail','manufacturing'],ARRAY['in'],ARRAY['GSTN']),
      ('reg-mas-pack','MAS Notice 610 Pack','MAS 610 data reconciliation.','regulatory','reg-apac',ARRAY['banking'],ARRAY['sg'],ARRAY['MAS']),
      ('reg-osfi-pack','OSFI B-20/B-13 Pack','OSFI reconciliation.','regulatory','reg-global',ARRAY['banking'],ARRAY['ca'],ARRAY['OSFI']),
      ('reg-sama-pack','SAMA Prudential Pack','SAMA prudential reconciliation.','regulatory','reg-me',ARRAY['banking'],ARRAY['sa'],ARRAY['SAMA']),
      ('reg-adgm-pack','ADGM FSRA Pack','ADGM FSRA reconciliation.','regulatory','reg-me',ARRAY['banking'],ARRAY['ae'],ARRAY['ADGM']),
      ('reg-difc-pack','DIFC DFSA Pack','DIFC DFSA reconciliation.','regulatory','reg-me',ARRAY['banking'],ARRAY['ae'],ARRAY['DIFC']),
      ('std-ifrs','IFRS Reconciliation Standard','IFRS-aligned reconciliation baseline.','regulatory','reg-global',ARRAY['banking','insurance','manufacturing'],ARRAY['global'],ARRAY['IFRS']),
      ('std-gaap','US GAAP Reconciliation Standard','GAAP-aligned reconciliation baseline.','regulatory','reg-global',ARRAY['banking','manufacturing'],ARRAY['us'],ARRAY['GAAP']),
      ('std-basel3','Basel III Reconciliation Pack','Regulatory capital reconciliation.','regulatory','reg-global',ARRAY['banking'],ARRAY['global'],ARRAY['Basel III']),
      ('std-sox','SOX Controls Pack','SOX 404 reconciliation controls.','regulatory','reg-global',ARRAY['banking','manufacturing'],ARRAY['us'],ARRAY['SOX']),
      ('std-fatca','FATCA Reconciliation Pack','FATCA W-8/W-9 reconciliation.','regulatory','reg-global',ARRAY['banking'],ARRAY['global'],ARRAY['FATCA']),
      ('std-crs','CRS Reconciliation Pack','OECD CRS reconciliation.','regulatory','reg-global',ARRAY['banking'],ARRAY['global'],ARRAY['CRS']),
      ('std-iso20022','ISO 20022 Message Pack','ISO 20022 payment message reconciliation.','regulatory','reg-global',ARRAY['banking','payments'],ARRAY['global'],ARRAY['ISO20022']),
      ('std-swift','SWIFT MT/MX Pack','SWIFT message reconciliation.','regulatory','reg-global',ARRAY['banking'],ARRAY['global'],ARRAY['SWIFT']),
      ('featured-daily-close','Daily Financial Close Pack','End-to-end daily close reconciliation suite.','featured','pack-fs',ARRAY['banking'],ARRAY['global'],ARRAY['IFRS','GAAP','SOX']),
      ('featured-payments-360','Payments 360 Pack','End-to-end payments reconciliation across PSPs, cards, wallets.','featured','pack-payments',ARRAY['payments'],ARRAY['global'],ARRAY['PCI-DSS','PSD2']),
      ('featured-capmkts-t1','Capital Markets T+1 Pack','T+1 settlement readiness suite.','featured','pack-fs',ARRAY['capital-markets'],ARRAY['us'],ARRAY['SEC','FINRA']),
      ('featured-insurance-close','Insurance Close Pack','End-to-end insurance close and reporting.','featured','pack-fs',ARRAY['insurance'],ARRAY['global'],ARRAY['Solvency II','IFRS 17'])
    ) AS t(slug,title,summary,pack_type,cat_slug,industries,regions,standards)
  LOOP
    INSERT INTO public.mkt_templates(slug,title,summary,description,pack_type,certification,visibility,license,industries,regions,standards,category_id)
    VALUES (rec.slug, rec.title, rec.summary, rec.summary,
      rec.pack_type::public.mkt_tpl_pack_type,
      'certified'::public.mkt_tpl_certification,
      'public'::public.mkt_tpl_visibility,
      'free'::public.mkt_tpl_license,
      rec.industries, rec.regions, rec.standards,
      (SELECT id FROM public.mkt_template_categories WHERE slug = rec.cat_slug))
    ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary, updated_at = now()
    RETURNING id INTO v_template_id;

    INSERT INTO public.mkt_template_versions(template_id, semver, status, spec, changelog, published_at)
    VALUES (v_template_id, '1.0.0', 'published',
      jsonb_build_object(
        'kind','reconciliation',
        'matching', jsonb_build_object('modes', ARRAY['exact','tolerance','fuzzy','ai']),
        'mapping', '{}'::jsonb,
        'workflow', jsonb_build_object('approvals', ARRAY['maker','checker']),
        'controls', rec.standards,
        'reports', ARRAY['exceptions','sla','audit']
      ), 'Initial certified release', now())
    ON CONFLICT (template_id, semver) DO NOTHING
    RETURNING id INTO v_version_id;

    UPDATE public.mkt_templates
    SET current_version_id = COALESCE(v_version_id, current_version_id)
    WHERE id = v_template_id;
  END LOOP;
END $$;
