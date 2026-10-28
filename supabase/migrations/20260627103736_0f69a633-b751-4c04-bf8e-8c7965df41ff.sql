
-- ============================================================
-- 1. ML MATCH CONFIDENCE + FEEDBACK LOOP
-- ============================================================
ALTER TABLE public.recon_matches
  ADD COLUMN IF NOT EXISTS confidence numeric(5,4),
  ADD COLUMN IF NOT EXISTS confidence_model text,
  ADD COLUMN IF NOT EXISTS feature_vector jsonb;

CREATE TABLE IF NOT EXISTS public.recon_match_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  recon_id uuid NOT NULL REFERENCES public.recon_definitions(id) ON DELETE CASCADE,
  match_id uuid REFERENCES public.recon_matches(id) ON DELETE SET NULL,
  exception_id uuid REFERENCES public.recon_exceptions(id) ON DELETE SET NULL,
  decision text NOT NULL CHECK (decision IN ('accept','reject','correct','uncertain')),
  feature_vector jsonb,
  predicted_confidence numeric(5,4),
  correction jsonb,
  notes text,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_match_feedback_tenant_recon ON public.recon_match_feedback(tenant_id, recon_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recon_match_feedback TO authenticated;
GRANT ALL ON public.recon_match_feedback TO service_role;
ALTER TABLE public.recon_match_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant members read match feedback" ON public.recon_match_feedback
  FOR SELECT TO authenticated USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "tenant analysts write match feedback" ON public.recon_match_feedback
  FOR INSERT TO authenticated WITH CHECK (
    public.user_has_tenant_role_or_group(auth.uid(), tenant_id, 'tenant_analyst')
    OR public.user_has_tenant_role_or_group(auth.uid(), tenant_id, 'tenant_admin')
  );

-- ============================================================
-- 2. NEAR-REAL-TIME / INTRADAY POLLING ON SCHEDULES
-- ============================================================
ALTER TABLE public.recon_schedules
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'cron' CHECK (mode IN ('cron','intraday_poll','manual')),
  ADD COLUMN IF NOT EXISTS poll_interval_seconds integer,
  ADD COLUMN IF NOT EXISTS watermark_column text,
  ADD COLUMN IF NOT EXISTS watermark_value text,
  ADD COLUMN IF NOT EXISTS intraday_window_minutes integer DEFAULT 60;

ALTER TABLE public.data_source_schedules
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'cron' CHECK (mode IN ('cron','intraday_poll','manual')),
  ADD COLUMN IF NOT EXISTS poll_interval_seconds integer;

-- ============================================================
-- 3. REGULATORY TEMPLATE PACKS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.regulatory_template_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  jurisdiction text NOT NULL,
  regulation text NOT NULL,
  version text NOT NULL DEFAULT '1.0.0',
  effective_from date,
  summary text,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','deprecated')),
  definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags text[] DEFAULT '{}',
  install_count integer NOT NULL DEFAULT 0,
  published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_regpacks_status ON public.regulatory_template_packs(status, regulation);
GRANT SELECT ON public.regulatory_template_packs TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.regulatory_template_packs TO authenticated;
GRANT ALL ON public.regulatory_template_packs TO service_role;
ALTER TABLE public.regulatory_template_packs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "regpacks public read published" ON public.regulatory_template_packs
  FOR SELECT TO anon, authenticated USING (status = 'published' OR public.is_platform_admin(auth.uid()));
CREATE POLICY "regpacks platform admin write" ON public.regulatory_template_packs
  FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_regpacks_updated_at BEFORE UPDATE ON public.regulatory_template_packs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.regulatory_pack_installs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  pack_id uuid NOT NULL REFERENCES public.regulatory_template_packs(id) ON DELETE CASCADE,
  recon_id uuid REFERENCES public.recon_definitions(id) ON DELETE SET NULL,
  installed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  installed_version text,
  installed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, pack_id, installed_version)
);
GRANT SELECT, INSERT, DELETE ON public.regulatory_pack_installs TO authenticated;
GRANT ALL ON public.regulatory_pack_installs TO service_role;
ALTER TABLE public.regulatory_pack_installs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "regpack installs tenant scoped" ON public.regulatory_pack_installs
  FOR SELECT TO authenticated USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "regpack installs tenant admin write" ON public.regulatory_pack_installs
  FOR INSERT TO authenticated WITH CHECK (public.user_has_tenant_role_or_group(auth.uid(), tenant_id, 'tenant_admin'));

-- ============================================================
-- 4. MARKETPLACE (templates, transforms, connectors)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('recon_template','data_prep_pipeline','connector_config','rule_pack','dashboard')),
  tier text NOT NULL DEFAULT 'community' CHECK (tier IN ('community','partner','official')),
  publisher text,
  summary text,
  description text,
  version text NOT NULL DEFAULT '1.0.0',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','deprecated','archived')),
  install_count integer NOT NULL DEFAULT 0,
  rating_avg numeric(3,2),
  rating_count integer NOT NULL DEFAULT 0,
  published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketplace_kind_status ON public.marketplace_listings(kind, status);
GRANT SELECT ON public.marketplace_listings TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.marketplace_listings TO authenticated;
GRANT ALL ON public.marketplace_listings TO service_role;
ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "marketplace public read" ON public.marketplace_listings
  FOR SELECT TO anon, authenticated USING (status = 'published' OR public.is_platform_admin(auth.uid()));
CREATE POLICY "marketplace platform admin write" ON public.marketplace_listings
  FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_marketplace_updated_at BEFORE UPDATE ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.marketplace_installs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  installed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  installed_version text,
  target_resource_type text,
  target_resource_id uuid,
  installed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.marketplace_installs TO authenticated;
GRANT ALL ON public.marketplace_installs TO service_role;
ALTER TABLE public.marketplace_installs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "marketplace installs tenant scoped" ON public.marketplace_installs
  FOR SELECT TO authenticated USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "marketplace installs tenant admin write" ON public.marketplace_installs
  FOR INSERT TO authenticated WITH CHECK (public.user_has_tenant_role_or_group(auth.uid(), tenant_id, 'tenant_admin'));

CREATE TABLE IF NOT EXISTS public.marketplace_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_ratings TO authenticated;
GRANT ALL ON public.marketplace_ratings TO service_role;
ALTER TABLE public.marketplace_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ratings readable" ON public.marketplace_ratings FOR SELECT TO authenticated USING (true);
CREATE POLICY "ratings own write" ON public.marketplace_ratings
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "ratings own update" ON public.marketplace_ratings
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 5. PUBLISHED PRICING TIERS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pricing_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  tagline text,
  monthly_price_cents integer,
  annual_price_cents integer,
  currency text NOT NULL DEFAULT 'USD',
  records_per_month bigint,
  active_recons integer,
  connectors integer,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  cta_label text DEFAULT 'Start free',
  stripe_price_id text,
  is_public boolean NOT NULL DEFAULT true,
  is_contact_sales boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pricing_tiers TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.pricing_tiers TO authenticated;
GRANT ALL ON public.pricing_tiers TO service_role;
ALTER TABLE public.pricing_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pricing public read" ON public.pricing_tiers FOR SELECT TO anon, authenticated USING (is_public OR public.is_platform_admin(auth.uid()));
CREATE POLICY "pricing platform admin write" ON public.pricing_tiers FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_pricing_updated_at BEFORE UPDATE ON public.pricing_tiers
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- 6. BREAK KNOWLEDGE GRAPH
-- ============================================================
CREATE TABLE IF NOT EXISTS public.break_graph_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_exception_id uuid NOT NULL REFERENCES public.recon_exceptions(id) ON DELETE CASCADE,
  target_exception_id uuid NOT NULL REFERENCES public.recon_exceptions(id) ON DELETE CASCADE,
  edge_type text NOT NULL CHECK (edge_type IN ('same_counterparty','same_field','same_error','same_recon','time_proximity','same_root_cause','manual_link')),
  weight numeric(5,4) NOT NULL DEFAULT 0.5,
  evidence jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_exception_id, target_exception_id, edge_type)
);
CREATE INDEX IF NOT EXISTS idx_graph_tenant_type ON public.break_graph_edges(tenant_id, edge_type);
CREATE INDEX IF NOT EXISTS idx_graph_source ON public.break_graph_edges(source_exception_id);
CREATE INDEX IF NOT EXISTS idx_graph_target ON public.break_graph_edges(target_exception_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.break_graph_edges TO authenticated;
GRANT ALL ON public.break_graph_edges TO service_role;
ALTER TABLE public.break_graph_edges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "graph edges tenant read" ON public.break_graph_edges
  FOR SELECT TO authenticated USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "graph edges tenant analyst write" ON public.break_graph_edges
  FOR INSERT TO authenticated WITH CHECK (
    public.user_has_tenant_role_or_group(auth.uid(), tenant_id, 'tenant_analyst')
    OR public.user_has_tenant_role_or_group(auth.uid(), tenant_id, 'tenant_admin')
  );

CREATE TABLE IF NOT EXISTS public.break_root_causes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  label text NOT NULL,
  category text,
  confidence numeric(5,4),
  occurrence_count integer NOT NULL DEFAULT 0,
  representative_exception_id uuid REFERENCES public.recon_exceptions(id) ON DELETE SET NULL,
  attributes jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_root_cause_tenant ON public.break_root_causes(tenant_id, last_seen_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.break_root_causes TO authenticated;
GRANT ALL ON public.break_root_causes TO service_role;
ALTER TABLE public.break_root_causes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "root cause tenant read" ON public.break_root_causes
  FOR SELECT TO authenticated USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "root cause tenant analyst write" ON public.break_root_causes
  FOR ALL TO authenticated
  USING (public.user_has_tenant_role_or_group(auth.uid(), tenant_id, 'tenant_analyst') OR public.user_has_tenant_role_or_group(auth.uid(), tenant_id, 'tenant_admin'))
  WITH CHECK (public.user_has_tenant_role_or_group(auth.uid(), tenant_id, 'tenant_analyst') OR public.user_has_tenant_role_or_group(auth.uid(), tenant_id, 'tenant_admin'));

-- ============================================================
-- 7. DATA QUALITY / UPSTREAM OBSERVABILITY
-- ============================================================
CREATE TABLE IF NOT EXISTS public.data_source_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  data_source_id uuid NOT NULL REFERENCES public.workspace_data_sources(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL DEFAULT now(),
  row_count bigint,
  null_ratio numeric(5,4),
  schema_fingerprint text,
  schema_drift boolean NOT NULL DEFAULT false,
  latency_seconds integer,
  volume_anomaly_score numeric(5,4),
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','warn','breach','unknown')),
  details jsonb
);
CREATE INDEX IF NOT EXISTS idx_dsh_tenant_source_time ON public.data_source_health(tenant_id, data_source_id, observed_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_source_health TO authenticated;
GRANT ALL ON public.data_source_health TO service_role;
ALTER TABLE public.data_source_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dsh tenant read" ON public.data_source_health
  FOR SELECT TO authenticated USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "dsh tenant analyst write" ON public.data_source_health
  FOR INSERT TO authenticated WITH CHECK (public.user_has_tenant_role_or_group(auth.uid(), tenant_id, 'tenant_analyst') OR public.user_has_tenant_role_or_group(auth.uid(), tenant_id, 'tenant_admin'));

CREATE TABLE IF NOT EXISTS public.data_source_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  data_source_id uuid NOT NULL REFERENCES public.workspace_data_sources(id) ON DELETE CASCADE,
  severity text NOT NULL CHECK (severity IN ('info','warn','critical')),
  alert_type text NOT NULL,
  message text NOT NULL,
  details jsonb,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dsa_tenant_open ON public.data_source_alerts(tenant_id, acknowledged_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_source_alerts TO authenticated;
GRANT ALL ON public.data_source_alerts TO service_role;
ALTER TABLE public.data_source_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dsa tenant read" ON public.data_source_alerts
  FOR SELECT TO authenticated USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "dsa tenant analyst write" ON public.data_source_alerts
  FOR ALL TO authenticated
  USING (public.user_has_tenant_role_or_group(auth.uid(), tenant_id, 'tenant_analyst') OR public.user_has_tenant_role_or_group(auth.uid(), tenant_id, 'tenant_admin'))
  WITH CHECK (public.user_has_tenant_role_or_group(auth.uid(), tenant_id, 'tenant_analyst') OR public.user_has_tenant_role_or_group(auth.uid(), tenant_id, 'tenant_admin'));

-- ============================================================
-- 8. AIDP MULTI-SIDE GROUPS (single / two-side / tri-side)
-- ============================================================
ALTER TABLE public.aidp_documents
  ADD COLUMN IF NOT EXISTS side_role text CHECK (side_role IN ('side_a','side_b','side_c')),
  ADD COLUMN IF NOT EXISTS group_id uuid;

CREATE TABLE IF NOT EXISTS public.aidp_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  sidedness text NOT NULL CHECK (sidedness IN ('single','two','tri')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','pushed','archived')),
  side_a_label text DEFAULT 'Side A',
  side_b_label text,
  side_c_label text,
  pushed_recon_id uuid REFERENCES public.recon_definitions(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aidp_groups_tenant ON public.aidp_groups(tenant_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.aidp_groups TO authenticated;
GRANT ALL ON public.aidp_groups TO service_role;
ALTER TABLE public.aidp_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aidp groups tenant read" ON public.aidp_groups
  FOR SELECT TO authenticated USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "aidp groups tenant analyst write" ON public.aidp_groups
  FOR ALL TO authenticated
  USING (public.user_has_tenant_role_or_group(auth.uid(), tenant_id, 'tenant_analyst') OR public.user_has_tenant_role_or_group(auth.uid(), tenant_id, 'tenant_admin'))
  WITH CHECK (public.user_has_tenant_role_or_group(auth.uid(), tenant_id, 'tenant_analyst') OR public.user_has_tenant_role_or_group(auth.uid(), tenant_id, 'tenant_admin'));
CREATE TRIGGER trg_aidp_groups_updated_at BEFORE UPDATE ON public.aidp_groups
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Best-effort soft FK from aidp_documents.group_id → aidp_groups.id
ALTER TABLE public.aidp_documents
  ADD CONSTRAINT aidp_documents_group_fk FOREIGN KEY (group_id) REFERENCES public.aidp_groups(id) ON DELETE SET NULL;

-- ============================================================
-- 9. SEED CONTENT — regulatory packs, marketplace, pricing
-- ============================================================
INSERT INTO public.regulatory_template_packs (code, title, jurisdiction, regulation, version, summary, status, tags, definition, published_at)
VALUES
  ('emir-eu-1', 'EMIR EU — Trade Repository Reconciliation', 'EU', 'EMIR', '1.0.0',
   'Pre-built recon for ESMA EMIR REFIT trade repository submissions vs internal trade store. Includes UTI/USI matching, asset-class tolerances, and 30+ ESMA validation rules.',
   'published', ARRAY['emir','eu','trade-repository','refit'],
   '{"side_a":"Internal Trade Store","side_b":"Trade Repository","keys":["UTI","report_timestamp"],"tolerances":{"notional":0.01,"price":0.0001},"asset_classes":["RATES","FX","EQUITY","CREDIT","COMMODITY"]}'::jsonb,
   now()),
  ('sftr-eu-1', 'SFTR EU — Securities Financing Transaction Reporting', 'EU', 'SFTR', '1.0.0',
   'Reconciles SFT trade store vs ESMA SFTR trade repository. UTI matching, collateral block, valuation block, modification chain integrity.',
   'published', ARRAY['sftr','eu','securities-financing'],
   '{"side_a":"SFT Store","side_b":"Trade Repository","keys":["UTI","event_date"],"blocks":["principal","collateral","margin"]}'::jsonb,
   now()),
  ('cftc-pr-1', 'CFTC Part 43/45 — Swap Data Reporting', 'US', 'CFTC', '1.0.0',
   'Reconciles internal swap blotter vs CFTC SDR submissions for Part 43 (real-time) and Part 45 (regulatory) reports.',
   'published', ARRAY['cftc','us','swaps','sdr'],
   '{"side_a":"Swap Blotter","side_b":"SDR Submission","keys":["USI"],"tolerances":{"notional":0.01}}'::jsonb,
   now()),
  ('mifid-ii-1', 'MiFID II — Transaction Reporting Recon', 'EU', 'MiFID II', '1.0.0',
   'ARM/NCA transaction reporting reconciliation with 65-field validation block.',
   'published', ARRAY['mifid','eu','transaction-reporting'],
   '{"side_a":"Execution Store","side_b":"ARM Submission","keys":["transaction_reference_number"]}'::jsonb,
   now()),
  ('t1-settlement-1', 'T+1 Settlement Readiness Pack', 'US/UK/EU', 'T+1', '1.0.0',
   'Intraday allocation, affirmation, and matching control pack for T+1 settlement readiness.',
   'published', ARRAY['t1','settlement','intraday'],
   '{"controls":["allocation","affirmation","matching","ssi"],"intraday":true}'::jsonb,
   now())
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.marketplace_listings (slug, title, kind, tier, publisher, summary, version, payload, tags, status, published_at)
VALUES
  ('cash-nostro-starter', 'Cash & Nostro — Starter Pack', 'recon_template', 'official', 'FVI', 'Best-practice cash and nostro reconciliation with MT940 ingestion and 1:1 + 1:many matching.', '1.0.0', '{}'::jsonb, ARRAY['cash','nostro','swift'], 'published', now()),
  ('iso20022-camt053-prep', 'ISO 20022 camt.053 — Data Prep', 'data_prep_pipeline', 'official', 'FVI', 'Parses camt.053 bank statements into normalized recon-ready rows.', '1.0.0', '{}'::jsonb, ARRAY['iso20022','camt053'], 'published', now()),
  ('intercompany-month-end', 'Intercompany Month-End Close', 'recon_template', 'official', 'FVI', 'Two-sided intercompany ledger recon with fuzzy entity matching.', '1.0.0', '{}'::jsonb, ARRAY['intercompany','gl','close'], 'published', now())
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.pricing_tiers (code, name, position, tagline, monthly_price_cents, annual_price_cents, records_per_month, active_recons, connectors, features, cta_label, is_contact_sales)
VALUES
  ('starter', 'Starter', 1, 'For lean teams getting first recons live in under an hour.', 0, 0, 500000, 5, 3,
   '["AI Copilot (Meta AI)","Up to 5 active recons","500K records / month","3 connectors","Hash-chained audit","Community support"]'::jsonb, 'Start free', false),
  ('growth', 'Growth', 2, 'Scale across business lines with regulatory templates and AI agents.', 83400, 1000000, 5000000, 25, 10,
   '["Everything in Starter","Up to 25 active recons","5M records / month","10 connectors","AI Agents + Break Inspector","Regulatory template packs","SLA support"]'::jsonb, 'Start trial', false),
  ('enterprise', 'Enterprise', 3, 'BYO-LLM, dedicated silo, custom residency.', NULL, NULL, NULL, NULL, NULL,
   '["Unlimited recons + volume","BYO-LLM & AI governance","Dedicated silo / data residency","SSO/SAML + SCIM","Premier support","Agent orchestration"]'::jsonb, 'Contact sales', true)
ON CONFLICT (code) DO NOTHING;
