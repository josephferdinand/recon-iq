
-- ============================================================================
-- PLATFORM ADMIN GAP-CLOSURE (Batch 1, corrected) — 41-gap backlog enablers
-- ============================================================================

-- New platform_role enum values (G-10) — must precede any use.
ALTER TYPE public.platform_role ADD VALUE IF NOT EXISTS 'security_admin';
ALTER TYPE public.platform_role ADD VALUE IF NOT EXISTS 'compliance_admin';
ALTER TYPE public.platform_role ADD VALUE IF NOT EXISTS 'billing_admin';
ALTER TYPE public.platform_role ADD VALUE IF NOT EXISTS 'readonly_admin';

-- Shared updated_at trigger fn
CREATE OR REPLACE FUNCTION public.gap_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- G-1/G-8/G-9 — Revenue KPI snapshots, per-tenant usage, health score
CREATE TABLE IF NOT EXISTS public.platform_revenue_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL UNIQUE,
  mrr_cents bigint NOT NULL DEFAULT 0,
  arr_cents bigint NOT NULL DEFAULT 0,
  new_mrr_cents bigint NOT NULL DEFAULT 0,
  expansion_mrr_cents bigint NOT NULL DEFAULT 0,
  churned_mrr_cents bigint NOT NULL DEFAULT 0,
  logo_churn_pct numeric(6,3) NOT NULL DEFAULT 0,
  revenue_churn_pct numeric(6,3) NOT NULL DEFAULT 0,
  active_tenants int NOT NULL DEFAULT 0,
  paying_tenants int NOT NULL DEFAULT 0,
  monthly_active_users int NOT NULL DEFAULT 0,
  storage_bytes bigint NOT NULL DEFAULT 0,
  api_calls_30d bigint NOT NULL DEFAULT 0,
  computed_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.platform_revenue_snapshots TO authenticated;
GRANT ALL ON public.platform_revenue_snapshots TO service_role;
ALTER TABLE public.platform_revenue_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa read rev snap" ON public.platform_revenue_snapshots FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));
CREATE POLICY "pa write rev snap" ON public.platform_revenue_snapshots FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_rev_snap BEFORE UPDATE ON public.platform_revenue_snapshots FOR EACH ROW EXECUTE FUNCTION public.gap_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.platform_tenant_usage_kpis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  window_start date NOT NULL,
  window_end date NOT NULL,
  api_calls bigint NOT NULL DEFAULT 0,
  storage_bytes bigint NOT NULL DEFAULT 0,
  mau int NOT NULL DEFAULT 0,
  ai_tokens bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tenant_usage_kpis_lookup ON public.platform_tenant_usage_kpis(tenant_id, window_end DESC);
GRANT SELECT ON public.platform_tenant_usage_kpis TO authenticated;
GRANT ALL ON public.platform_tenant_usage_kpis TO service_role;
ALTER TABLE public.platform_tenant_usage_kpis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa read usage" ON public.platform_tenant_usage_kpis FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));
CREATE POLICY "pa write usage" ON public.platform_tenant_usage_kpis FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.platform_tenant_health_scores (
  tenant_id uuid PRIMARY KEY,
  score numeric(5,2) NOT NULL DEFAULT 0,
  score_band text NOT NULL DEFAULT 'unknown' CHECK (score_band IN ('healthy','watch','at_risk','critical','unknown')),
  factors jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.platform_tenant_health_scores TO authenticated;
GRANT ALL ON public.platform_tenant_health_scores TO service_role;
ALTER TABLE public.platform_tenant_health_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa read health" ON public.platform_tenant_health_scores FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));
CREATE POLICY "pa write health" ON public.platform_tenant_health_scores FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

-- G-2 Invoices + billing alerts
CREATE TABLE IF NOT EXISTS public.platform_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  invoice_number text NOT NULL,
  provider text NOT NULL DEFAULT 'stripe',
  external_id text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','paid','uncollectible','void','past_due')),
  amount_cents bigint NOT NULL DEFAULT 0,
  tax_cents bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  issued_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  pdf_url text,
  hosted_url text,
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, invoice_number)
);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_tenant ON public.platform_invoices(tenant_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_status ON public.platform_invoices(status);
GRANT SELECT, INSERT, UPDATE ON public.platform_invoices TO authenticated;
GRANT ALL ON public.platform_invoices TO service_role;
ALTER TABLE public.platform_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa read invoices" ON public.platform_invoices FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));
CREATE POLICY "pa write invoices" ON public.platform_invoices FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_invoices BEFORE UPDATE ON public.platform_invoices FOR EACH ROW EXECUTE FUNCTION public.gap_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.platform_billing_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  alert_type text NOT NULL CHECK (alert_type IN ('overage','failed_payment','trial_ending','contract_renewal','usage_spike','dunning','other')),
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  title text NOT NULL,
  detail text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','snoozed')),
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_alerts_status ON public.platform_billing_alerts(status, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.platform_billing_alerts TO authenticated;
GRANT ALL ON public.platform_billing_alerts TO service_role;
ALTER TABLE public.platform_billing_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa read billing alerts" ON public.platform_billing_alerts FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));
CREATE POLICY "pa manage billing alerts" ON public.platform_billing_alerts FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_billing_alerts BEFORE UPDATE ON public.platform_billing_alerts FOR EACH ROW EXECUTE FUNCTION public.gap_touch_updated_at();

-- G-3 Tax + dunning
CREATE TABLE IF NOT EXISTS public.platform_tax_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL,
  region_code text,
  provider text NOT NULL DEFAULT 'stripe_tax',
  provider_account_id text,
  registration_number text,
  active boolean NOT NULL DEFAULT true,
  effective_from date,
  effective_to date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(country_code, region_code, provider)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_tax_configs TO authenticated;
GRANT ALL ON public.platform_tax_configs TO service_role;
ALTER TABLE public.platform_tax_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa manage tax" ON public.platform_tax_configs FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_tax BEFORE UPDATE ON public.platform_tax_configs FOR EACH ROW EXECUTE FUNCTION public.gap_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.platform_dunning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  invoice_id uuid REFERENCES public.platform_invoices(id) ON DELETE SET NULL,
  step int NOT NULL DEFAULT 1,
  channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms','in_app','call','other')),
  outcome text NOT NULL DEFAULT 'sent' CHECK (outcome IN ('sent','delivered','opened','clicked','paid','failed','escalated')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_dunning_tenant ON public.platform_dunning_events(tenant_id, occurred_at DESC);
GRANT SELECT, INSERT ON public.platform_dunning_events TO authenticated;
GRANT ALL ON public.platform_dunning_events TO service_role;
ALTER TABLE public.platform_dunning_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa read dunning" ON public.platform_dunning_events FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));
CREATE POLICY "pa write dunning" ON public.platform_dunning_events FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin(auth.uid()));

-- G-4 Forecasts + chargeback
CREATE TABLE IF NOT EXISTS public.platform_revenue_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_month date NOT NULL,
  scenario text NOT NULL DEFAULT 'base' CHECK (scenario IN ('base','optimistic','conservative')),
  predicted_mrr_cents bigint NOT NULL DEFAULT 0,
  predicted_arr_cents bigint NOT NULL DEFAULT 0,
  confidence_pct numeric(5,2) NOT NULL DEFAULT 0,
  assumptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(forecast_month, scenario)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_revenue_forecasts TO authenticated;
GRANT ALL ON public.platform_revenue_forecasts TO service_role;
ALTER TABLE public.platform_revenue_forecasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa manage forecasts" ON public.platform_revenue_forecasts FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.platform_department_chargebacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  department text NOT NULL,
  period_month date NOT NULL,
  allocated_cents bigint NOT NULL DEFAULT 0,
  usage_metric text,
  usage_value numeric(18,4) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, department, period_month)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_department_chargebacks TO authenticated;
GRANT ALL ON public.platform_department_chargebacks TO service_role;
ALTER TABLE public.platform_department_chargebacks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa manage chargebacks" ON public.platform_department_chargebacks FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

-- G-5 Contract vault
CREATE TABLE IF NOT EXISTS public.platform_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  contract_type text NOT NULL CHECK (contract_type IN ('MSA','DPA','BAA','SOW','NDA','SLA','OrderForm','Amendment','Other')),
  title text NOT NULL,
  counterparty text NOT NULL,
  effective_date date,
  expiry_date date,
  auto_renew boolean NOT NULL DEFAULT false,
  renewal_notice_days int,
  value_cents bigint,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','under_review','active','expired','terminated','superseded')),
  storage_path text,
  file_hash_sha256 text,
  data_classification text NOT NULL DEFAULT 'confidential' CHECK (data_classification IN ('public','internal','confidential','restricted')),
  owner_user_id uuid,
  tags text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contracts_tenant ON public.platform_contracts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON public.platform_contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_expiry ON public.platform_contracts(expiry_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_contracts TO authenticated;
GRANT ALL ON public.platform_contracts TO service_role;
ALTER TABLE public.platform_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa manage contracts" ON public.platform_contracts FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_contracts BEFORE UPDATE ON public.platform_contracts FOR EACH ROW EXECUTE FUNCTION public.gap_touch_updated_at();

-- G-6/G-25/G-26/G-27 Approvals aids
CREATE TABLE IF NOT EXISTS public.platform_approval_diffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_kind text NOT NULL,
  subject_id text NOT NULL,
  before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  diff_summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_approval_diffs_subject ON public.platform_approval_diffs(subject_kind, subject_id);
GRANT SELECT, INSERT ON public.platform_approval_diffs TO authenticated;
GRANT ALL ON public.platform_approval_diffs TO service_role;
ALTER TABLE public.platform_approval_diffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa read diffs" ON public.platform_approval_diffs FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));
CREATE POLICY "pa write diffs" ON public.platform_approval_diffs FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.platform_approval_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_kind text NOT NULL,
  approval_id text NOT NULL,
  breached_at timestamptz NOT NULL DEFAULT now(),
  original_approver uuid,
  escalated_to uuid,
  reason text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.platform_approval_escalations TO authenticated;
GRANT ALL ON public.platform_approval_escalations TO service_role;
ALTER TABLE public.platform_approval_escalations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa manage esc" ON public.platform_approval_escalations FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_esc BEFORE UPDATE ON public.platform_approval_escalations FOR EACH ROW EXECUTE FUNCTION public.gap_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.platform_approver_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approver_user_id uuid NOT NULL,
  delegate_user_id uuid NOT NULL,
  scope text NOT NULL DEFAULT 'all',
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  reason text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (approver_user_id <> delegate_user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_approver_delegations TO authenticated;
GRANT ALL ON public.platform_approver_delegations TO service_role;
ALTER TABLE public.platform_approver_delegations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user reads own delegations" ON public.platform_approver_delegations FOR SELECT TO authenticated USING (approver_user_id = auth.uid() OR delegate_user_id = auth.uid() OR public.is_platform_admin(auth.uid()));
CREATE POLICY "pa manage delegations" ON public.platform_approver_delegations FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_delegations BEFORE UPDATE ON public.platform_approver_delegations FOR EACH ROW EXECUTE FUNCTION public.gap_touch_updated_at();

-- G-11/G-12 MFA
CREATE TABLE IF NOT EXISTS public.platform_mfa_totp (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  label text NOT NULL DEFAULT 'Authenticator',
  secret_encrypted text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, label)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_mfa_totp TO authenticated;
GRANT ALL ON public.platform_mfa_totp TO service_role;
ALTER TABLE public.platform_mfa_totp ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own totp" ON public.platform_mfa_totp FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER trg_totp BEFORE UPDATE ON public.platform_mfa_totp FOR EACH ROW EXECUTE FUNCTION public.gap_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.platform_mfa_sms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  phone_e164 text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  last_sent_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, phone_e164)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_mfa_sms TO authenticated;
GRANT ALL ON public.platform_mfa_sms TO service_role;
ALTER TABLE public.platform_mfa_sms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own sms" ON public.platform_mfa_sms FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER trg_sms BEFORE UPDATE ON public.platform_mfa_sms FOR EACH ROW EXECUTE FUNCTION public.gap_touch_updated_at();

-- G-13 Password policy
CREATE TABLE IF NOT EXISTS public.platform_password_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'global' CHECK (scope IN ('global','tenant')),
  tenant_id uuid,
  min_length int NOT NULL DEFAULT 12,
  require_upper boolean NOT NULL DEFAULT true,
  require_lower boolean NOT NULL DEFAULT true,
  require_number boolean NOT NULL DEFAULT true,
  require_symbol boolean NOT NULL DEFAULT true,
  disallow_reuse_last int NOT NULL DEFAULT 10,
  max_age_days int NOT NULL DEFAULT 90,
  warn_before_days int NOT NULL DEFAULT 14,
  hibp_check boolean NOT NULL DEFAULT true,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_password_policy_scope ON public.platform_password_policies(scope, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid));
GRANT SELECT, INSERT, UPDATE ON public.platform_password_policies TO authenticated;
GRANT ALL ON public.platform_password_policies TO service_role;
ALTER TABLE public.platform_password_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa manage pwd policy" ON public.platform_password_policies FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_pwd BEFORE UPDATE ON public.platform_password_policies FOR EACH ROW EXECUTE FUNCTION public.gap_touch_updated_at();

-- G-14 Session policy
CREATE TABLE IF NOT EXISTS public.platform_session_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'global' CHECK (scope IN ('global','tenant')),
  tenant_id uuid,
  single_session_mode boolean NOT NULL DEFAULT false,
  idle_timeout_minutes int NOT NULL DEFAULT 30,
  absolute_timeout_hours int NOT NULL DEFAULT 12,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_session_policy_scope ON public.platform_session_policies(scope, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid));
GRANT SELECT, INSERT, UPDATE ON public.platform_session_policies TO authenticated;
GRANT ALL ON public.platform_session_policies TO service_role;
ALTER TABLE public.platform_session_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa manage sess policy" ON public.platform_session_policies FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_sess BEFORE UPDATE ON public.platform_session_policies FOR EACH ROW EXECUTE FUNCTION public.gap_touch_updated_at();

-- G-16 Data classification
CREATE TABLE IF NOT EXISTS public.platform_data_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_kind text NOT NULL,
  resource_id text NOT NULL,
  classification text NOT NULL CHECK (classification IN ('public','internal','confidential','restricted')),
  reason text,
  set_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(resource_kind, resource_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_data_classifications TO authenticated;
GRANT ALL ON public.platform_data_classifications TO service_role;
ALTER TABLE public.platform_data_classifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa manage classifications" ON public.platform_data_classifications FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_class BEFORE UPDATE ON public.platform_data_classifications FOR EACH ROW EXECUTE FUNCTION public.gap_touch_updated_at();

-- G-17/G-18 Policy versions + simulations
CREATE TABLE IF NOT EXISTS public.platform_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_kind text NOT NULL,
  policy_id text NOT NULL,
  version int NOT NULL,
  snapshot jsonb NOT NULL,
  change_note text,
  authored_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(policy_kind, policy_id, version)
);
CREATE INDEX IF NOT EXISTS idx_policy_versions ON public.platform_policy_versions(policy_kind, policy_id, version DESC);
GRANT SELECT, INSERT ON public.platform_policy_versions TO authenticated;
GRANT ALL ON public.platform_policy_versions TO service_role;
ALTER TABLE public.platform_policy_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa read pol ver" ON public.platform_policy_versions FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));
CREATE POLICY "pa write pol ver" ON public.platform_policy_versions FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.platform_policy_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_kind text NOT NULL,
  policy_id text NOT NULL,
  proposed_snapshot jsonb NOT NULL,
  blast_radius jsonb NOT NULL DEFAULT '{}'::jsonb,
  affected_tenants int NOT NULL DEFAULT 0,
  affected_users int NOT NULL DEFAULT 0,
  risk_band text NOT NULL DEFAULT 'unknown' CHECK (risk_band IN ('low','medium','high','critical','unknown')),
  ran_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.platform_policy_simulations TO authenticated;
GRANT ALL ON public.platform_policy_simulations TO service_role;
ALTER TABLE public.platform_policy_simulations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa manage pol sim" ON public.platform_policy_simulations FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

-- G-19 Geo
CREATE TABLE IF NOT EXISTS public.platform_geo_restrictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'global' CHECK (scope IN ('global','tenant')),
  tenant_id uuid,
  mode text NOT NULL DEFAULT 'block' CHECK (mode IN ('allow','block')),
  country_codes text[] NOT NULL DEFAULT '{}',
  reason text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_geo_restrictions TO authenticated;
GRANT ALL ON public.platform_geo_restrictions TO service_role;
ALTER TABLE public.platform_geo_restrictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa manage geo" ON public.platform_geo_restrictions FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_geo BEFORE UPDATE ON public.platform_geo_restrictions FOR EACH ROW EXECUTE FUNCTION public.gap_touch_updated_at();

-- G-20 model risk
ALTER TABLE public.ai_governance_models
  ADD COLUMN IF NOT EXISTS risk_rating text CHECK (risk_rating IN ('low','medium','high','critical')),
  ADD COLUMN IF NOT EXISTS risk_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS risk_reviewer uuid,
  ADD COLUMN IF NOT EXISTS risk_notes text;

-- G-21..24 Lifecycle ops
CREATE TABLE IF NOT EXISTS public.platform_tenant_lifecycle_ops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  op_kind text NOT NULL CHECK (op_kind IN ('clone','merge','transfer','archive','restore')),
  source_tenant_id uuid,
  target_tenant_id uuid,
  requested_by uuid NOT NULL,
  approved_by uuid,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','running','completed','failed','cancelled')),
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_life_ops_status ON public.platform_tenant_lifecycle_ops(status, requested_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.platform_tenant_lifecycle_ops TO authenticated;
GRANT ALL ON public.platform_tenant_lifecycle_ops TO service_role;
ALTER TABLE public.platform_tenant_lifecycle_ops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa manage life ops" ON public.platform_tenant_lifecycle_ops FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_life BEFORE UPDATE ON public.platform_tenant_lifecycle_ops FOR EACH ROW EXECUTE FUNCTION public.gap_touch_updated_at();

-- G-28..30 Environments + deployments
CREATE TABLE IF NOT EXISTS public.platform_environments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  tier text NOT NULL CHECK (tier IN ('dev','qa','uat','staging','prod','dr')),
  region text,
  requires_approval boolean NOT NULL DEFAULT false,
  approver_roles text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_environments TO authenticated;
GRANT ALL ON public.platform_environments TO service_role;
ALTER TABLE public.platform_environments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa manage envs" ON public.platform_environments FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_envs BEFORE UPDATE ON public.platform_environments FOR EACH ROW EXECUTE FUNCTION public.gap_touch_updated_at();

INSERT INTO public.platform_environments (name, tier, requires_approval, approver_roles) VALUES
  ('dev','dev',false,'{}'),
  ('qa','qa',false,'{}'),
  ('uat','uat',true,ARRAY['platform_admin','compliance_admin']),
  ('staging','staging',true,ARRAY['platform_admin']),
  ('prod','prod',true,ARRAY['platform_admin','security_admin']),
  ('dr','dr',true,ARRAY['platform_admin'])
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.platform_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id uuid NOT NULL REFERENCES public.platform_environments(id) ON DELETE RESTRICT,
  release_tag text NOT NULL,
  commit_sha text,
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','approved','deploying','succeeded','failed','rolled_back','cancelled')),
  requested_by uuid,
  approved_by uuid,
  deployed_at timestamptz,
  rolled_back_at timestamptz,
  rollback_reason text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deploys_env_status ON public.platform_deployments(environment_id, status, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.platform_deployments TO authenticated;
GRANT ALL ON public.platform_deployments TO service_role;
ALTER TABLE public.platform_deployments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa manage deploys" ON public.platform_deployments FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_deploys BEFORE UPDATE ON public.platform_deployments FOR EACH ROW EXECUTE FUNCTION public.gap_touch_updated_at();

-- G-31/G-32 RCA + capacity
CREATE TABLE IF NOT EXISTS public.platform_incident_rca_hints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid,
  hint text NOT NULL,
  confidence numeric(5,2) NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'auto',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.platform_incident_rca_hints TO authenticated;
GRANT ALL ON public.platform_incident_rca_hints TO service_role;
ALTER TABLE public.platform_incident_rca_hints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa read rca" ON public.platform_incident_rca_hints FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));
CREATE POLICY "pa write rca" ON public.platform_incident_rca_hints FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.platform_capacity_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource text NOT NULL,
  forecast_window text NOT NULL,
  horizon_days int NOT NULL DEFAULT 30,
  predicted_usage numeric(18,4) NOT NULL DEFAULT 0,
  capacity numeric(18,4) NOT NULL DEFAULT 0,
  headroom_pct numeric(5,2) NOT NULL DEFAULT 0,
  breach_eta_days int,
  computed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.platform_capacity_forecasts TO authenticated;
GRANT ALL ON public.platform_capacity_forecasts TO service_role;
ALTER TABLE public.platform_capacity_forecasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa read cap" ON public.platform_capacity_forecasts FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));
CREATE POLICY "pa write cap" ON public.platform_capacity_forecasts FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin(auth.uid()));

-- G-33/G-34 Compliance bundles + PHI
CREATE TABLE IF NOT EXISTS public.platform_compliance_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework text NOT NULL CHECK (framework IN ('SOC2','ISO27001','HIPAA','GDPR','PCI-DSS','DORA','FedRAMP')),
  bundle_name text NOT NULL,
  period_start date,
  period_end date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved','signed','archived')),
  storage_path text,
  controls jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.platform_compliance_bundles TO authenticated;
GRANT ALL ON public.platform_compliance_bundles TO service_role;
ALTER TABLE public.platform_compliance_bundles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa manage bundles" ON public.platform_compliance_bundles FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_bundles BEFORE UPDATE ON public.platform_compliance_bundles FOR EACH ROW EXECUTE FUNCTION public.gap_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.platform_phi_markers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE,
  contains_phi boolean NOT NULL DEFAULT false,
  baa_contract_id uuid REFERENCES public.platform_contracts(id) ON DELETE SET NULL,
  attested_by uuid,
  attested_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.platform_phi_markers TO authenticated;
GRANT ALL ON public.platform_phi_markers TO service_role;
ALTER TABLE public.platform_phi_markers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa manage phi" ON public.platform_phi_markers FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_phi BEFORE UPDATE ON public.platform_phi_markers FOR EACH ROW EXECUTE FUNCTION public.gap_touch_updated_at();

-- G-35/G-36 Risk register + exceptions
CREATE TABLE IF NOT EXISTS public.platform_risk_register (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  risk_ref text UNIQUE NOT NULL,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'operational',
  inherent_likelihood text NOT NULL DEFAULT 'medium' CHECK (inherent_likelihood IN ('low','medium','high','critical')),
  inherent_impact text NOT NULL DEFAULT 'medium' CHECK (inherent_impact IN ('low','medium','high','critical')),
  residual_likelihood text NOT NULL DEFAULT 'medium' CHECK (residual_likelihood IN ('low','medium','high','critical')),
  residual_impact text NOT NULL DEFAULT 'medium' CHECK (residual_impact IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','mitigated','accepted','transferred','closed')),
  owner_user_id uuid,
  next_review_date date,
  mitigations jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_risk_register TO authenticated;
GRANT ALL ON public.platform_risk_register TO service_role;
ALTER TABLE public.platform_risk_register ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa manage risk" ON public.platform_risk_register FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_risk BEFORE UPDATE ON public.platform_risk_register FOR EACH ROW EXECUTE FUNCTION public.gap_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.platform_compliance_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_ref text UNIQUE NOT NULL,
  title text NOT NULL,
  description text,
  control_ref text,
  requested_by uuid,
  business_justification text,
  compensating_controls text,
  approved_by uuid,
  approved_at timestamptz,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','under_review','approved','rejected','expired','revoked')),
  effective_from date,
  expires_at date,
  risk_id uuid REFERENCES public.platform_risk_register(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.platform_compliance_exceptions TO authenticated;
GRANT ALL ON public.platform_compliance_exceptions TO service_role;
ALTER TABLE public.platform_compliance_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa manage exceptions" ON public.platform_compliance_exceptions FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_exc BEFORE UPDATE ON public.platform_compliance_exceptions FOR EACH ROW EXECUTE FUNCTION public.gap_touch_updated_at();

-- G-37 Theme palettes
CREATE TABLE IF NOT EXISTS public.platform_theme_palettes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  display_name text NOT NULL,
  mode text NOT NULL DEFAULT 'light' CHECK (mode IN ('light','dark','auto')),
  tokens jsonb NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.platform_theme_palettes TO authenticated;
GRANT ALL ON public.platform_theme_palettes TO service_role;
ALTER TABLE public.platform_theme_palettes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authed read palettes" ON public.platform_theme_palettes FOR SELECT TO authenticated USING (true);
CREATE POLICY "pa manage palettes" ON public.platform_theme_palettes FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_pal BEFORE UPDATE ON public.platform_theme_palettes FOR EACH ROW EXECUTE FUNCTION public.gap_touch_updated_at();

INSERT INTO public.platform_theme_palettes (slug, display_name, mode, tokens, is_default, sort_order) VALUES
  ('arctic','Arctic','light', jsonb_build_object('primary','#0EA5E9','accent','#7DD3FC','background','#F8FAFC','foreground','#0F172A'), true, 10),
  ('cloud','Cloud','light', jsonb_build_object('primary','#64748B','accent','#94A3B8','background','#FFFFFF','foreground','#0F172A'), false, 20),
  ('ivory','Ivory','light', jsonb_build_object('primary','#B45309','accent','#F59E0B','background','#FFFBEB','foreground','#1F1400'), false, 30),
  ('midnight','Midnight','dark', jsonb_build_object('primary','#818CF8','accent','#22D3EE','background','#0B1220','foreground','#E5E7EB'), false, 40),
  ('ocean','Ocean','light', jsonb_build_object('primary','#0369A1','accent','#06B6D4','background','#ECFEFF','foreground','#0C4A6E'), false, 50),
  ('forest','Forest','light', jsonb_build_object('primary','#166534','accent','#84CC16','background','#F0FDF4','foreground','#052E16'), false, 60),
  ('slate','Slate','dark', jsonb_build_object('primary','#94A3B8','accent','#CBD5E1','background','#0F172A','foreground','#E2E8F0'), false, 70),
  ('ember','Ember','dark', jsonb_build_object('primary','#F97316','accent','#F59E0B','background','#1C1917','foreground','#FEF3C7'), false, 80)
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name, mode = EXCLUDED.mode, tokens = EXCLUDED.tokens, sort_order = EXCLUDED.sort_order;

-- G-38/G-39 Saved commands + command registry
CREATE TABLE IF NOT EXISTS public.platform_saved_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  label text NOT NULL,
  command_key text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  hotkey text,
  sort_order int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, label)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_saved_commands TO authenticated;
GRANT ALL ON public.platform_saved_commands TO service_role;
ALTER TABLE public.platform_saved_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user own saved cmds" ON public.platform_saved_commands FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER trg_scmd BEFORE UPDATE ON public.platform_saved_commands FOR EACH ROW EXECUTE FUNCTION public.gap_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.platform_command_registry (
  command_key text PRIMARY KEY,
  label text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  route text,
  action text,
  required_role text,
  description text,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.platform_command_registry TO authenticated;
GRANT ALL ON public.platform_command_registry TO service_role;
ALTER TABLE public.platform_command_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authed read cmd reg" ON public.platform_command_registry FOR SELECT TO authenticated USING (true);
CREATE POLICY "pa manage cmd reg" ON public.platform_command_registry FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

INSERT INTO public.platform_command_registry (command_key, label, category, route, description) VALUES
  ('open.executive_dashboard','Open Executive Dashboard','navigation','/platform?page=executive','Consolidated KPI + alert view'),
  ('open.revenue_dashboard','Open Revenue Dashboard','navigation','/platform?page=revenue','MRR/ARR/churn/forecast'),
  ('open.contract_vault','Open Contract Vault','navigation','/platform?page=contracts','MSA/DPA/BAA repository'),
  ('open.risk_register','Open Risk Register','navigation','/platform?page=risk','Enterprise risks'),
  ('open.exceptions','Open Exceptions Workflow','navigation','/platform?page=exceptions','Compliance exceptions'),
  ('open.deployments','Open Deployment Approvals','navigation','/platform?page=deployments','CI/CD approvals & rollback'),
  ('open.rca','Open RCA Hints','navigation','/platform?page=rca','Auto RCA hints per incident'),
  ('open.capacity','Open Capacity Forecasts','navigation','/platform?page=capacity','Headroom & breach ETA'),
  ('open.themes','Open Theme Palettes','navigation','/platform?page=themes','Arctic/Cloud/Ivory/Midnight/Ocean/Forest/Slate/Ember'),
  ('open.tenant_lifecycle','Open Tenant Lifecycle','navigation','/platform?page=tenant_lifecycle','Clone/Merge/Transfer/Archive'),
  ('open.geo_restrictions','Open Geo Restrictions','navigation','/platform?page=geo','Allow/Block country policy'),
  ('open.policy_simulator','Open Policy Simulator','navigation','/platform?page=policy_sim','Blast radius + rollback'),
  ('open.data_classification','Open Data Classification','navigation','/platform?page=classification','public/internal/confidential/restricted'),
  ('open.compliance_bundles','Open Compliance Bundles','navigation','/platform?page=compliance','SOC2/ISO/HIPAA/GDPR/DORA'),
  ('open.password_policy','Open Password Policy','navigation','/platform?page=password_policy','Rotation + strength'),
  ('open.session_policy','Open Session Policy','navigation','/platform?page=session_policy','Single-session mode + timeouts'),
  ('open.load_tests','Open Load Test Results','navigation','/platform?page=load_tests','10^6 user scale evidence')
ON CONFLICT (command_key) DO UPDATE SET
  label = EXCLUDED.label, category = EXCLUDED.category, route = EXCLUDED.route, description = EXCLUDED.description;

-- G-40 Hallucination
CREATE TABLE IF NOT EXISTS public.platform_hallucination_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  sample_size int NOT NULL DEFAULT 0,
  hallucination_count int NOT NULL DEFAULT 0,
  hallucination_rate numeric(6,3) NOT NULL DEFAULT 0,
  severity_avg numeric(4,2) NOT NULL DEFAULT 0,
  detector text NOT NULL DEFAULT 'heuristic',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hallu ON public.platform_hallucination_metrics(model_id, window_end DESC);
GRANT SELECT, INSERT ON public.platform_hallucination_metrics TO authenticated;
GRANT ALL ON public.platform_hallucination_metrics TO service_role;
ALTER TABLE public.platform_hallucination_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa read hallu" ON public.platform_hallucination_metrics FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));
CREATE POLICY "pa write hallu" ON public.platform_hallucination_metrics FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin(auth.uid()));

-- G-41 Load tests
CREATE TABLE IF NOT EXISTS public.platform_load_test_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_name text NOT NULL,
  target_users bigint NOT NULL,
  achieved_users bigint NOT NULL,
  duration_seconds int NOT NULL,
  p50_ms int NOT NULL DEFAULT 0,
  p95_ms int NOT NULL DEFAULT 0,
  p99_ms int NOT NULL DEFAULT 0,
  error_rate_pct numeric(6,3) NOT NULL DEFAULT 0,
  throughput_rps bigint NOT NULL DEFAULT 0,
  scenario jsonb NOT NULL DEFAULT '{}'::jsonb,
  report_url text,
  ran_at timestamptz NOT NULL DEFAULT now(),
  ran_by uuid,
  passed boolean NOT NULL DEFAULT false,
  notes text
);
GRANT SELECT, INSERT ON public.platform_load_test_results TO authenticated;
GRANT ALL ON public.platform_load_test_results TO service_role;
ALTER TABLE public.platform_load_test_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa read load" ON public.platform_load_test_results FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));
CREATE POLICY "pa write load" ON public.platform_load_test_results FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin(auth.uid()));
