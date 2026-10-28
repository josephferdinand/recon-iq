
ALTER TABLE public.eod_signoffs
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS certified_at timestamptz,
  ADD COLUMN IF NOT EXISTS certified_hash text,
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS period_label text,
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_breach_at timestamptz,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reopened_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.signoff_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  signoff_id uuid NOT NULL REFERENCES public.eod_signoffs(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  actor uuid NOT NULL,
  comment text,
  evidence_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.signoff_transitions TO authenticated;
GRANT ALL ON public.signoff_transitions TO service_role;
ALTER TABLE public.signoff_transitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signoff_transitions_read" ON public.signoff_transitions
  FOR SELECT TO authenticated USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "signoff_transitions_insert" ON public.signoff_transitions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id) AND actor = auth.uid());
CREATE INDEX IF NOT EXISTS idx_signoff_transitions_signoff ON public.signoff_transitions(signoff_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.signoff_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  signoff_id uuid NOT NULL REFERENCES public.eod_signoffs(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  sha256 text NOT NULL,
  filename text NOT NULL,
  size_bytes bigint,
  uploaded_by uuid NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.signoff_evidence TO authenticated;
GRANT ALL ON public.signoff_evidence TO service_role;
ALTER TABLE public.signoff_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signoff_evidence_read" ON public.signoff_evidence
  FOR SELECT TO authenticated USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "signoff_evidence_write" ON public.signoff_evidence
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id) AND uploaded_by = auth.uid());
CREATE POLICY "signoff_evidence_delete" ON public.signoff_evidence
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));

CREATE OR REPLACE FUNCTION public.tg_signoff_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.locked = true AND NEW.locked = true AND NEW.status = OLD.status THEN
      RAISE EXCEPTION 'Sign-off % is certified and locked', OLD.id USING ERRCODE = '42501';
    END IF;
    IF NEW.reviewed_by IS NOT NULL AND NEW.reviewed_by = NEW.prepared_by THEN
      RAISE EXCEPTION 'Reviewer cannot be the preparer' USING ERRCODE = '42501';
    END IF;
    IF NEW.approved_by IS NOT NULL AND (NEW.approved_by = NEW.prepared_by OR NEW.approved_by = NEW.reviewed_by) THEN
      RAISE EXCEPTION 'Approver cannot be the preparer or reviewer' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'certified' AND (OLD.status IS DISTINCT FROM 'certified') THEN
      NEW.locked := true;
      NEW.certified_at := COALESCE(NEW.certified_at, now());
      NEW.certified_hash := encode(digest(
        COALESCE(NEW.id::text,'') ||
        COALESCE(NEW.tenant_id::text,'') ||
        COALESCE(NEW.period_date::text,'') ||
        COALESCE(NEW.prepared_by::text,'') ||
        COALESCE(NEW.reviewed_by::text,'') ||
        COALESCE(NEW.approved_by::text,'') ||
        COALESCE(NEW.certified_at::text,''), 'sha256'), 'hex');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tg_signoff_guard ON public.eod_signoffs;
CREATE TRIGGER tg_signoff_guard BEFORE UPDATE ON public.eod_signoffs
  FOR EACH ROW EXECUTE FUNCTION public.tg_signoff_guard();
REVOKE EXECUTE ON FUNCTION public.tg_signoff_guard() FROM PUBLIC;

ALTER TABLE public.balance_substantiations
  ADD COLUMN IF NOT EXISTS gl_source text,
  ADD COLUMN IF NOT EXISTS recon_id uuid,
  ADD COLUMN IF NOT EXISTS recon_run_id uuid,
  ADD COLUMN IF NOT EXISTS ageing_buckets jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS supporting_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS variance_explanation text,
  ADD COLUMN IF NOT EXISTS variance_category text,
  ADD COLUMN IF NOT EXISTS reviewer_id uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_recon_status text,
  ADD COLUMN IF NOT EXISTS last_recon_at timestamptz;

CREATE OR REPLACE VIEW public.v_substantiation_status AS
SELECT b.*,
  CASE
    WHEN abs(COALESCE(b.variance,0)) <= COALESCE(b.tolerance,0) THEN 'green'
    WHEN abs(COALESCE(b.variance,0)) <= COALESCE(b.tolerance,0) * 3 THEN 'amber'
    ELSE 'red'
  END AS traffic_light
FROM public.balance_substantiations b;
GRANT SELECT ON public.v_substantiation_status TO authenticated;

ALTER TABLE public.recon_schedules
  ADD COLUMN IF NOT EXISTS risk_score numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS risk_tier text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS priority_boost integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS value_threshold numeric,
  ADD COLUMN IF NOT EXISTS volatility_30d numeric,
  ADD COLUMN IF NOT EXISTS last_risk_eval_at timestamptz;

CREATE TABLE IF NOT EXISTS public.recon_risk_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  recon_id uuid NOT NULL,
  factor_code text NOT NULL,
  weight numeric(5,2) NOT NULL DEFAULT 1,
  value numeric(10,4) NOT NULL DEFAULT 0,
  rationale text,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, recon_id, factor_code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recon_risk_factors TO authenticated;
GRANT ALL ON public.recon_risk_factors TO service_role;
ALTER TABLE public.recon_risk_factors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recon_risk_factors_read" ON public.recon_risk_factors
  FOR SELECT TO authenticated USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "recon_risk_factors_write" ON public.recon_risk_factors
  FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));

CREATE OR REPLACE FUNCTION public.compute_recon_risk(p_recon_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_score numeric; v_tier text;
BEGIN
  SELECT LEAST(100, COALESCE(SUM(weight * value), 0))
    INTO v_score FROM public.recon_risk_factors WHERE recon_id = p_recon_id;
  v_tier := CASE WHEN v_score >= 75 THEN 'critical' WHEN v_score >= 50 THEN 'high' WHEN v_score >= 25 THEN 'medium' ELSE 'low' END;
  UPDATE public.recon_schedules
     SET risk_score = v_score, risk_tier = v_tier, last_risk_eval_at = now()
   WHERE definition_id = p_recon_id;
  RETURN v_score;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compute_recon_risk(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_recon_risk(uuid) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_schedule_priority_queue AS
SELECT s.*, d.name AS recon_name, d.tenant_id AS recon_tenant_id
  FROM public.recon_schedules s
  JOIN public.recon_definitions d ON d.id = s.definition_id
 WHERE s.enabled = true
 ORDER BY (s.risk_score + s.priority_boost) DESC NULLS LAST, s.last_run_at ASC NULLS FIRST;
GRANT SELECT ON public.v_schedule_priority_queue TO authenticated;

ALTER TABLE public.recon_definition_templates ADD COLUMN IF NOT EXISTS account_type text;

INSERT INTO public.recon_definition_templates (code, asset_class, title, summary, description, legs, keys, tolerances, rules, sample_fields, tags, status, account_type) VALUES
  ('acct_nostro_v1','cash','Nostro account close','Bank vs internal cash ledger with FX tolerance','Two-sided Nostro close template tuned for daily certification.','[{"name":"bank"},{"name":"internal"}]','["value_date","reference"]','{"amount":{"abs":0.01,"pct":0}}','[{"type":"exact","fields":["reference"]}]','["amount","currency","value_date","reference"]','{nostro,close}','published','nostro'),
  ('acct_vostro_v1','cash','Vostro counterparty close','Counterparty mirror against internal book','Two-sided Vostro close with mirrored sign convention.','[{"name":"counterparty"},{"name":"internal"}]','["value_date","reference"]','{"amount":{"abs":0.01,"pct":0}}','[{"type":"exact","fields":["reference"]}]','["amount","currency","value_date","reference"]','{vostro,close}','published','vostro'),
  ('acct_suspense_v1','gl','Suspense ageing','Suspense GL ageing and substantiation','Ageing-driven substantiation; flags >30d items.','[{"name":"gl"}]','["txn_id"]','{"amount":{"abs":0}}','[{"type":"ageing","buckets":[0,30,60,90]}]','["amount","txn_id","posted_at"]','{suspense,gl}','published','suspense'),
  ('acct_clearing_v1','gl','Clearing account close','Clearing balance to zero with carry-forward','Daily clear-to-zero with carry-forward for unresolved items.','[{"name":"gl"}]','["txn_id"]','{"amount":{"abs":0.01}}','[{"type":"zero_balance"}]','["amount","txn_id"]','{clearing,close}','published','clearing'),
  ('acct_intercompany_v1','gl','Intercompany match','Entity A vs Entity B with FX normalisation','Two-sided intercompany with FX-normalised compare.','[{"name":"entity_a"},{"name":"entity_b"}]','["ic_ref"]','{"amount":{"abs":0.01,"pct":0.001}}','[{"type":"exact","fields":["ic_ref"]}]','["amount","ccy","ic_ref"]','{intercompany}','published','intercompany'),
  ('acct_fee_v1','fees','Fee accrual recon','Vendor invoice vs GL fee accrual','Fee accrual vs invoice match with tolerance ladder.','[{"name":"vendor"},{"name":"gl"}]','["invoice_no"]','{"amount":{"abs":1,"pct":0.005}}','[{"type":"exact","fields":["invoice_no"]}]','["amount","invoice_no"]','{fees}','published','fee'),
  ('acct_tax_v1','gl','Tax liability close','Tax authority statement vs GL liability','Period tax substantiation.','[{"name":"authority"},{"name":"gl"}]','["period","tax_code"]','{"amount":{"abs":1}}','[{"type":"exact","fields":["period","tax_code"]}]','["amount","period","tax_code"]','{tax}','published','tax'),
  ('acct_payroll_v1','gl','Payroll close','Payroll provider vs payroll GL','Run-level payroll certification.','[{"name":"provider"},{"name":"gl"}]','["run_id"]','{"amount":{"abs":0.5}}','[{"type":"exact","fields":["run_id"]}]','["amount","run_id"]','{payroll}','published','payroll'),
  ('acct_trust_v1','gl','Client trust close','Client trust ledger vs bank statement','Daily trust account close with regulatory note.','[{"name":"trust"},{"name":"bank"}]','["client_id","value_date"]','{"amount":{"abs":0.01}}','[{"type":"exact","fields":["client_id","value_date"]}]','["amount","client_id","value_date"]','{trust}','published','trust')
ON CONFLICT (code) DO UPDATE SET account_type = EXCLUDED.account_type;

CREATE TABLE IF NOT EXISTS public.config_change_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  resource_type text NOT NULL,
  requires_maker_checker boolean NOT NULL DEFAULT true,
  min_approvers integer NOT NULL DEFAULT 1,
  self_approval_blocked boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, resource_type)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.config_change_policies TO authenticated;
GRANT ALL ON public.config_change_policies TO service_role;
ALTER TABLE public.config_change_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "config_change_policies_read" ON public.config_change_policies
  FOR SELECT TO authenticated USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "config_change_policies_write" ON public.config_change_policies
  FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));

CREATE TABLE IF NOT EXISTS public.config_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  change_type text NOT NULL CHECK (change_type IN ('create','update','delete')),
  before_state jsonb,
  after_state jsonb,
  diff jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn','applied')),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  applied_at timestamptz,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.config_change_requests TO authenticated;
GRANT ALL ON public.config_change_requests TO service_role;
ALTER TABLE public.config_change_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "config_change_requests_read" ON public.config_change_requests
  FOR SELECT TO authenticated USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "config_change_requests_insert" ON public.config_change_requests
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id) AND requested_by = auth.uid());
CREATE POLICY "config_change_requests_decide" ON public.config_change_requests
  FOR UPDATE TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));
CREATE INDEX IF NOT EXISTS idx_config_change_pending ON public.config_change_requests(tenant_id, status, requested_at DESC);

INSERT INTO public.config_change_policies (tenant_id, resource_type, requires_maker_checker, min_approvers, self_approval_blocked)
SELECT t.id, rt, true, 1, true
FROM public.tenants t
CROSS JOIN (VALUES ('recon_definitions'),('recon_nrl_rules'),('recon_tolerance_ladders'),('reporting_field_mappings'),('reference_data_tables'),('exception_assignment_rules'),('break_sla_policies'),('agent_action_policies')) AS r(rt)
ON CONFLICT (tenant_id, resource_type) DO NOTHING;

DROP TRIGGER IF EXISTS tg_recon_risk_factors_updated ON public.recon_risk_factors;
CREATE TRIGGER tg_recon_risk_factors_updated BEFORE UPDATE ON public.recon_risk_factors
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS tg_config_change_policies_updated ON public.config_change_policies;
CREATE TRIGGER tg_config_change_policies_updated BEFORE UPDATE ON public.config_change_policies
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS tg_config_change_requests_updated ON public.config_change_requests;
CREATE TRIGGER tg_config_change_requests_updated BEFORE UPDATE ON public.config_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
