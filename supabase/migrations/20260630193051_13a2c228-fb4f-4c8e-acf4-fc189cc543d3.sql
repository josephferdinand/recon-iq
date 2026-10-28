
-- Phase 7 local trigger fn for updated_at
CREATE OR REPLACE FUNCTION public.phase7_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ---------- 1. Corporate Actions ------------------------------------------
CREATE TYPE public.ca_type AS ENUM (
  'cash_dividend','stock_dividend','stock_split','reverse_split',
  'rights_issue','bonus_issue','merger','spinoff','redemption','coupon','other'
);
CREATE TYPE public.ca_status AS ENUM (
  'announced','confirmed','ex','record','pending_pay','paid','cancelled','reconciled','broken'
);

CREATE TABLE public.corporate_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  ca_type public.ca_type NOT NULL,
  isin text,
  security_id uuid REFERENCES public.master_securities(id) ON DELETE SET NULL,
  external_ref text,
  ex_date date,
  record_date date,
  pay_date date,
  ratio numeric,
  gross_amount numeric,
  net_amount numeric,
  currency text,
  status public.ca_status NOT NULL DEFAULT 'announced',
  source text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_actions TO authenticated;
GRANT ALL ON public.corporate_actions TO service_role;
ALTER TABLE public.corporate_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY ca_tenant_read ON public.corporate_actions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = corporate_actions.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE POLICY ca_tenant_write ON public.corporate_actions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = corporate_actions.tenant_id AND tm.user_id = auth.uid() AND tm.active))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = corporate_actions.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE INDEX corporate_actions_tenant_status_idx ON public.corporate_actions(tenant_id, status);
CREATE INDEX corporate_actions_tenant_payday_idx ON public.corporate_actions(tenant_id, pay_date);
CREATE TRIGGER trg_corp_actions_updated BEFORE UPDATE ON public.corporate_actions
  FOR EACH ROW EXECUTE FUNCTION public.phase7_touch_updated_at();

CREATE TABLE public.ca_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  ca_id uuid NOT NULL REFERENCES public.corporate_actions(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.master_accounts(id) ON DELETE SET NULL,
  position_qty numeric NOT NULL DEFAULT 0,
  expected_amount numeric,
  received_amount numeric,
  variance numeric GENERATED ALWAYS AS (COALESCE(received_amount,0) - COALESCE(expected_amount,0)) STORED,
  status text NOT NULL DEFAULT 'pending',
  break_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ca_entitlements TO authenticated;
GRANT ALL ON public.ca_entitlements TO service_role;
ALTER TABLE public.ca_entitlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY cae_tenant_read ON public.ca_entitlements FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = ca_entitlements.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE POLICY cae_tenant_write ON public.ca_entitlements FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = ca_entitlements.tenant_id AND tm.user_id = auth.uid() AND tm.active))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = ca_entitlements.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE INDEX ca_entitlements_ca_idx ON public.ca_entitlements(ca_id);
CREATE TRIGGER trg_ca_entitlements_updated BEFORE UPDATE ON public.ca_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.phase7_touch_updated_at();

CREATE TABLE public.ca_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ca_id uuid NOT NULL REFERENCES public.corporate_actions(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  event text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.ca_lifecycle_events TO authenticated;
GRANT ALL ON public.ca_lifecycle_events TO service_role;
ALTER TABLE public.ca_lifecycle_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY cale_tenant_read ON public.ca_lifecycle_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = ca_lifecycle_events.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE POLICY cale_tenant_write ON public.ca_lifecycle_events FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = ca_lifecycle_events.tenant_id AND tm.user_id = auth.uid() AND tm.active));

-- ---------- 2. NAV / Fund Accounting --------------------------------------
CREATE TABLE public.fund_nav_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  fund_code text NOT NULL,
  nav_date date NOT NULL,
  official_nav numeric,
  shadow_nav numeric,
  variance numeric GENERATED ALWAYS AS (COALESCE(shadow_nav,0) - COALESCE(official_nav,0)) STORED,
  variance_bps numeric,
  status text NOT NULL DEFAULT 'in_progress',
  run_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, fund_code, nav_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fund_nav_runs TO authenticated;
GRANT ALL ON public.fund_nav_runs TO service_role;
ALTER TABLE public.fund_nav_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY nav_tenant_rw ON public.fund_nav_runs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = fund_nav_runs.tenant_id AND tm.user_id = auth.uid() AND tm.active))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = fund_nav_runs.tenant_id AND tm.user_id = auth.uid() AND tm.active));

CREATE TABLE public.fund_nav_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.fund_nav_runs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  component text NOT NULL,
  official_value numeric,
  shadow_value numeric,
  variance numeric GENERATED ALWAYS AS (COALESCE(shadow_value,0) - COALESCE(official_value,0)) STORED,
  notes text
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fund_nav_components TO authenticated;
GRANT ALL ON public.fund_nav_components TO service_role;
ALTER TABLE public.fund_nav_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY navc_tenant_rw ON public.fund_nav_components FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = fund_nav_components.tenant_id AND tm.user_id = auth.uid() AND tm.active))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = fund_nav_components.tenant_id AND tm.user_id = auth.uid() AND tm.active));

-- ---------- 3,4,5. Runbooks, DQ, Rule Optimisation -----------------------
CREATE TABLE public.agent_runbooks (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  applies_to text NOT NULL,
  steps jsonb NOT NULL,
  tools_allowlist text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.agent_runbooks TO authenticated, anon;
GRANT ALL ON public.agent_runbooks TO service_role;
ALTER TABLE public.agent_runbooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY runbooks_read ON public.agent_runbooks FOR SELECT TO authenticated, anon USING (true);

INSERT INTO public.agent_runbooks (code, name, description, applies_to, steps, tools_allowlist) VALUES
('rb_break_investigation_v1','Break Investigation','Diagnose a single break: fetch context, check schema drift, check counterparty, propose fix.','break',
 '[{"step":"fetch_break_context"},{"step":"diagnose_recon_failure"},{"step":"schema_drift_detector"},{"step":"recommend_fix"}]'::jsonb,
 ARRAY['fetchBreakContext','diagnoseReconFailure','schemaDriftDetector','recommendFix']),
('rb_dq_sweep_v1','Data Quality Sweep','Run all enabled DQ rules for a tenant and summarise violations by severity.','tenant',
 '[{"step":"list_dq_rules"},{"step":"evaluate_dq_rules"},{"step":"summarise_violations"}]'::jsonb,
 ARRAY['listDqRules','evaluateDqRules']),
('rb_rule_optimisation_v1','Rule Optimisation','Propose tolerance/key tweaks; run rule simulation; recommend promotion.','recon_definition',
 '[{"step":"profile_baseline"},{"step":"generate_candidates"},{"step":"run_simulation"},{"step":"recommend"}]'::jsonb,
 ARRAY['runSimulation','recommendFix']),
('rb_corporate_action_lifecycle_v1','CA Lifecycle','Walk a corporate action from announcement to reconciliation; raise breaks on variance.','corporate_action',
 '[{"step":"fetch_ca"},{"step":"compute_expected"},{"step":"compare_received"},{"step":"raise_break_if_variance"}]'::jsonb,
 ARRAY[]::text[]),
('rb_nav_shadow_v1','Shadow NAV','Compute shadow NAV; compare to official; flag bps variance > threshold.','fund',
 '[{"step":"price_positions"},{"step":"value_cash"},{"step":"sum_components"},{"step":"compare_official"}]'::jsonb,
 ARRAY[]::text[]),
('rb_drift_response_v1','Schema Drift Response','When upstream drift is detected, pause downstream recon and alert tenant_admins.','upstream_drift',
 '[{"step":"confirm_drift"},{"step":"pause_recon_schedule"},{"step":"notify_tenant_admins"}]'::jsonb,
 ARRAY['schemaDriftDetector']),
('rb_counterparty_outreach_v1','Counterparty Outreach','Draft and send counterparty break confirmation via approved plugin.','break',
 '[{"step":"identify_counterparty"},{"step":"draft_message"},{"step":"queue_outreach"}]'::jsonb,
 ARRAY['draftCounterpartyOutreach','queueOutreachMessage']),
('rb_red_team_v1','Red Team Self-Scan','Run adversarial test suite (RLS, prompt injection, BOLA, SCIM, masking).','platform',
 '[{"step":"rls_probes"},{"step":"prompt_injection_probes"},{"step":"masking_probes"},{"step":"summarise_findings"}]'::jsonb,
 ARRAY[]::text[]);

CREATE TABLE public.dq_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  target_schema text NOT NULL DEFAULT 'public',
  target_table text NOT NULL,
  expression text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dq_rules TO authenticated;
GRANT ALL ON public.dq_rules TO service_role;
ALTER TABLE public.dq_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY dq_rules_rw ON public.dq_rules FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = dq_rules.tenant_id AND tm.user_id = auth.uid() AND tm.active))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = dq_rules.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE TRIGGER trg_dq_rules_updated BEFORE UPDATE ON public.dq_rules
  FOR EACH ROW EXECUTE FUNCTION public.phase7_touch_updated_at();

CREATE TABLE public.dq_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dq_rule_id uuid NOT NULL REFERENCES public.dq_rules(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  run_at timestamptz NOT NULL DEFAULT now(),
  score numeric,
  violations integer NOT NULL DEFAULT 0,
  samples jsonb NOT NULL DEFAULT '[]'::jsonb,
  severity text NOT NULL DEFAULT 'medium'
);
GRANT SELECT, INSERT ON public.dq_results TO authenticated;
GRANT ALL ON public.dq_results TO service_role;
ALTER TABLE public.dq_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY dq_results_read ON public.dq_results FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = dq_results.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE POLICY dq_results_insert ON public.dq_results FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = dq_results.tenant_id AND tm.user_id = auth.uid() AND tm.active));

CREATE TABLE public.rule_optimisation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  recon_definition_id uuid,
  baseline_run_id uuid,
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendation jsonb,
  status text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
GRANT SELECT, INSERT, UPDATE ON public.rule_optimisation_runs TO authenticated;
GRANT ALL ON public.rule_optimisation_runs TO service_role;
ALTER TABLE public.rule_optimisation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY ror_rw ON public.rule_optimisation_runs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = rule_optimisation_runs.tenant_id AND tm.user_id = auth.uid() AND tm.active))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = rule_optimisation_runs.tenant_id AND tm.user_id = auth.uid() AND tm.active));

-- ---------- 6. Recon Knowledge Graph --------------------------------------
CREATE TABLE public.recon_kg_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  node_type text NOT NULL,
  node_key text NOT NULL,
  label text NOT NULL,
  attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, node_type, node_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recon_kg_nodes TO authenticated;
GRANT ALL ON public.recon_kg_nodes TO service_role;
ALTER TABLE public.recon_kg_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY kg_nodes_rw ON public.recon_kg_nodes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = recon_kg_nodes.tenant_id AND tm.user_id = auth.uid() AND tm.active))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = recon_kg_nodes.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE INDEX kg_nodes_type_idx ON public.recon_kg_nodes(tenant_id, node_type);

CREATE TABLE public.recon_kg_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  src_node_id uuid NOT NULL REFERENCES public.recon_kg_nodes(id) ON DELETE CASCADE,
  dst_node_id uuid NOT NULL REFERENCES public.recon_kg_nodes(id) ON DELETE CASCADE,
  edge_type text NOT NULL,
  weight numeric NOT NULL DEFAULT 1,
  attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recon_kg_edges TO authenticated;
GRANT ALL ON public.recon_kg_edges TO service_role;
ALTER TABLE public.recon_kg_edges ENABLE ROW LEVEL SECURITY;
CREATE POLICY kg_edges_rw ON public.recon_kg_edges FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = recon_kg_edges.tenant_id AND tm.user_id = auth.uid() AND tm.active))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = recon_kg_edges.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE INDEX kg_edges_src_idx ON public.recon_kg_edges(tenant_id, src_node_id);
CREATE INDEX kg_edges_dst_idx ON public.recon_kg_edges(tenant_id, dst_node_id);

CREATE OR REPLACE FUNCTION public.get_kg_neighbors(_tenant_id uuid, _node_id uuid, _max_depth integer DEFAULT 2)
RETURNS TABLE (node_id uuid, depth integer, edge_type text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE walk AS (
    SELECT e.dst_node_id AS node_id, 1 AS depth, e.edge_type
    FROM public.recon_kg_edges e
    WHERE e.tenant_id = _tenant_id AND e.src_node_id = _node_id
    UNION
    SELECT e.dst_node_id, w.depth + 1, e.edge_type
    FROM walk w
    JOIN public.recon_kg_edges e ON e.src_node_id = w.node_id AND e.tenant_id = _tenant_id
    WHERE w.depth < LEAST(_max_depth, 5)
  )
  SELECT node_id, depth, edge_type FROM walk;
$$;
REVOKE EXECUTE ON FUNCTION public.get_kg_neighbors(uuid, uuid, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_kg_neighbors(uuid, uuid, integer) TO authenticated, service_role;

-- ---------- 8. Upstream Drift Alerts --------------------------------------
CREATE TABLE public.upstream_drift_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  source text NOT NULL,
  metric text NOT NULL,
  baseline numeric,
  observed numeric,
  delta_pct numeric,
  severity text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'open',
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT, INSERT, UPDATE ON public.upstream_drift_alerts TO authenticated;
GRANT ALL ON public.upstream_drift_alerts TO service_role;
ALTER TABLE public.upstream_drift_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY drift_alerts_rw ON public.upstream_drift_alerts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = upstream_drift_alerts.tenant_id AND tm.user_id = auth.uid() AND tm.active))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = upstream_drift_alerts.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE INDEX upstream_drift_open_idx ON public.upstream_drift_alerts(tenant_id, status, detected_at DESC);

-- ---------- 9. Counterparty Outreach --------------------------------------
CREATE TABLE public.outreach_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  break_id uuid,
  channel text NOT NULL,
  recipient text NOT NULL,
  subject text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  sent_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
GRANT SELECT, INSERT, UPDATE ON public.outreach_messages TO authenticated;
GRANT ALL ON public.outreach_messages TO service_role;
ALTER TABLE public.outreach_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY outreach_rw ON public.outreach_messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = outreach_messages.tenant_id AND tm.user_id = auth.uid() AND tm.active))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = outreach_messages.tenant_id AND tm.user_id = auth.uid() AND tm.active));

-- ---------- 11. Dynamic Data Masking --------------------------------------
CREATE TABLE public.data_masking_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  schema_name text NOT NULL DEFAULT 'public',
  table_name text NOT NULL,
  column_name text NOT NULL,
  mask_strategy text NOT NULL DEFAULT 'redact',
  applies_to_roles text[] NOT NULL DEFAULT ARRAY['authenticated']::text[],
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, schema_name, table_name, column_name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_masking_rules TO authenticated;
GRANT ALL ON public.data_masking_rules TO service_role;
ALTER TABLE public.data_masking_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY masking_rules_rw ON public.data_masking_rules FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = data_masking_rules.tenant_id AND tm.user_id = auth.uid() AND tm.active))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = data_masking_rules.tenant_id AND tm.user_id = auth.uid() AND tm.active));

-- ---------- 12. Red-Team Scans --------------------------------------------
CREATE TABLE public.red_team_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  scan_type text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT, INSERT, UPDATE ON public.red_team_scans TO authenticated;
GRANT ALL ON public.red_team_scans TO service_role;
ALTER TABLE public.red_team_scans ENABLE ROW LEVEL SECURITY;
CREATE POLICY rts_read ON public.red_team_scans FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = red_team_scans.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE POLICY rts_write ON public.red_team_scans FOR INSERT TO authenticated
  WITH CHECK (tenant_id IS NULL OR EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = red_team_scans.tenant_id AND tm.user_id = auth.uid() AND tm.active));

-- ---------- 13. Regulatory Pack Catalog -----------------------------------
CREATE TABLE IF NOT EXISTS public.regulatory_pack_catalog (
  code text PRIMARY KEY,
  regulator text NOT NULL,
  jurisdiction text NOT NULL,
  version text NOT NULL,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'published',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.regulatory_pack_catalog TO authenticated, anon;
GRANT ALL ON public.regulatory_pack_catalog TO service_role;
ALTER TABLE public.regulatory_pack_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS regpack_read ON public.regulatory_pack_catalog;
CREATE POLICY regpack_read ON public.regulatory_pack_catalog FOR SELECT TO authenticated, anon USING (true);

INSERT INTO public.regulatory_pack_catalog (code, regulator, jurisdiction, version, fields) VALUES
('mas_610_v3',  'MAS',  'SG', '2023.03', '["asset_class","counterparty_lei","currency","notional","reporting_entity"]'::jsonb),
('fca_mifir_v2','FCA',  'UK', '2024.01', '["isin","trade_date","price","quantity","venue","buyer_lei","seller_lei"]'::jsonb),
('sec_cat_v3',  'SEC',  'US', '2024.02', '["firm_designated_id","order_id","timestamp_us","handling_instructions"]'::jsonb),
('sebi_oars_v1','SEBI', 'IN', '2024.07', '["isin","scheme_code","aum","nav","reporting_date"]'::jsonb),
('rbi_apr_v1',  'RBI',  'IN', '2024.04', '["entity_pan","cust_id","ifsc","amount","ccy","report_date"]'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- ---------- 10. Ingestion parser catalog (FpML + Parquet) ----------------
CREATE TABLE IF NOT EXISTS public.ingestion_parser_definitions (
  format_code text PRIMARY KEY,
  mime text NOT NULL,
  parser_module text NOT NULL,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true
);
GRANT SELECT ON public.ingestion_parser_definitions TO authenticated, anon;
GRANT ALL ON public.ingestion_parser_definitions TO service_role;
ALTER TABLE public.ingestion_parser_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ipd_read ON public.ingestion_parser_definitions;
CREATE POLICY ipd_read ON public.ingestion_parser_definitions FOR SELECT TO authenticated, anon USING (true);

INSERT INTO public.ingestion_parser_definitions (format_code, mime, parser_module, options) VALUES
('fpml_5_12','application/xml','src/lib/ingestion/parsers/fpml.parser.ts','{"variant":"5.12"}'::jsonb),
('parquet','application/vnd.apache.parquet','src/lib/ingestion/parsers/parquet.parser.ts','{"columnar":true}'::jsonb)
ON CONFLICT (format_code) DO NOTHING;
