
-- =====================================================================
-- PHASE 6 (P1) — Domain depth + continuous reconciliation loop  (retry)
-- =====================================================================

-- Master data
CREATE TABLE IF NOT EXISTS public.master_securities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  isin text, cusip text, sedol text, ticker text, figi text,
  asset_class text NOT NULL DEFAULT 'equity',
  currency text, issuer text, name text NOT NULL,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS master_securities_tenant_isin_idx ON public.master_securities(tenant_id, isin);
CREATE INDEX IF NOT EXISTS master_securities_tenant_ticker_idx ON public.master_securities(tenant_id, ticker);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.master_securities TO authenticated;
GRANT ALL ON public.master_securities TO service_role;
ALTER TABLE public.master_securities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ms_select ON public.master_securities;
DROP POLICY IF EXISTS ms_write  ON public.master_securities;
CREATE POLICY ms_select ON public.master_securities FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = master_securities.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE POLICY ms_write ON public.master_securities FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = master_securities.tenant_id AND tm.user_id = auth.uid() AND tm.active))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = master_securities.tenant_id AND tm.user_id = auth.uid() AND tm.active));

CREATE TABLE IF NOT EXISTS public.master_counterparties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lei text, bic text, short_name text NOT NULL, legal_name text,
  jurisdiction text, cp_type text NOT NULL DEFAULT 'bank',
  parent_id uuid REFERENCES public.master_counterparties(id) ON DELETE SET NULL,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS master_cp_tenant_lei_idx ON public.master_counterparties(tenant_id, lei);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.master_counterparties TO authenticated;
GRANT ALL ON public.master_counterparties TO service_role;
ALTER TABLE public.master_counterparties ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mc_select ON public.master_counterparties;
DROP POLICY IF EXISTS mc_write  ON public.master_counterparties;
CREATE POLICY mc_select ON public.master_counterparties FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = master_counterparties.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE POLICY mc_write ON public.master_counterparties FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = master_counterparties.tenant_id AND tm.user_id = auth.uid() AND tm.active))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = master_counterparties.tenant_id AND tm.user_id = auth.uid() AND tm.active));

CREATE TABLE IF NOT EXISTS public.master_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_number text NOT NULL,
  account_name text NOT NULL,
  account_type text NOT NULL DEFAULT 'nostro',
  currency text,
  custodian_id uuid REFERENCES public.master_counterparties(id) ON DELETE SET NULL,
  legal_entity text, business_unit text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, account_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.master_accounts TO authenticated;
GRANT ALL ON public.master_accounts TO service_role;
ALTER TABLE public.master_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ma_select ON public.master_accounts;
DROP POLICY IF EXISTS ma_write  ON public.master_accounts;
CREATE POLICY ma_select ON public.master_accounts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = master_accounts.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE POLICY ma_write ON public.master_accounts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = master_accounts.tenant_id AND tm.user_id = auth.uid() AND tm.active))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = master_accounts.tenant_id AND tm.user_id = auth.uid() AND tm.active));

-- Event-driven recon triggers
CREATE TABLE IF NOT EXISTS public.recon_event_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  schedule_id uuid NOT NULL REFERENCES public.recon_schedules(id) ON DELETE CASCADE,
  event_topic text NOT NULL,
  filter jsonb NOT NULL DEFAULT '{}'::jsonb,
  debounce_seconds integer NOT NULL DEFAULT 30,
  enabled boolean NOT NULL DEFAULT true,
  last_fired_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rec_event_trig_topic_idx ON public.recon_event_triggers(event_topic) WHERE enabled;
CREATE INDEX IF NOT EXISTS rec_event_trig_tenant_idx ON public.recon_event_triggers(tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recon_event_triggers TO authenticated;
GRANT ALL ON public.recon_event_triggers TO service_role;
ALTER TABLE public.recon_event_triggers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ret_select ON public.recon_event_triggers;
DROP POLICY IF EXISTS ret_write  ON public.recon_event_triggers;
CREATE POLICY ret_select ON public.recon_event_triggers FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = recon_event_triggers.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE POLICY ret_write ON public.recon_event_triggers FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = recon_event_triggers.tenant_id AND tm.user_id = auth.uid() AND tm.active))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = recon_event_triggers.tenant_id AND tm.user_id = auth.uid() AND tm.active));

-- Rule simulation
CREATE TABLE IF NOT EXISTS public.recon_rule_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  definition_id uuid NOT NULL REFERENCES public.recon_definitions(id) ON DELETE CASCADE,
  baseline_run_id uuid REFERENCES public.recon_runs(id) ON DELETE SET NULL,
  candidate_rules jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  baseline_matched integer DEFAULT 0,
  baseline_exceptions integer DEFAULT 0,
  candidate_matched integer DEFAULT 0,
  candidate_exceptions integer DEFAULT 0,
  delta jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recon_rule_simulations TO authenticated;
GRANT ALL ON public.recon_rule_simulations TO service_role;
ALTER TABLE public.recon_rule_simulations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rrs_select ON public.recon_rule_simulations;
DROP POLICY IF EXISTS rrs_write  ON public.recon_rule_simulations;
CREATE POLICY rrs_select ON public.recon_rule_simulations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = recon_rule_simulations.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE POLICY rrs_write ON public.recon_rule_simulations FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = recon_rule_simulations.tenant_id AND tm.user_id = auth.uid() AND tm.active))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = recon_rule_simulations.tenant_id AND tm.user_id = auth.uid() AND tm.active));

-- ABAC predicates
CREATE TABLE IF NOT EXISTS public.rbac_abac_predicates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  permission_id text NOT NULL,
  attribute text NOT NULL,
  operator text NOT NULL DEFAULT 'in',
  values jsonb NOT NULL DEFAULT '[]'::jsonb,
  description text,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS abac_tenant_perm_idx ON public.rbac_abac_predicates(tenant_id, permission_id) WHERE enabled;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rbac_abac_predicates TO authenticated;
GRANT ALL ON public.rbac_abac_predicates TO service_role;
ALTER TABLE public.rbac_abac_predicates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS abac_select ON public.rbac_abac_predicates;
DROP POLICY IF EXISTS abac_write  ON public.rbac_abac_predicates;
CREATE POLICY abac_select ON public.rbac_abac_predicates FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = rbac_abac_predicates.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE POLICY abac_write ON public.rbac_abac_predicates FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = rbac_abac_predicates.tenant_id AND tm.user_id = auth.uid() AND tm.active))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = rbac_abac_predicates.tenant_id AND tm.user_id = auth.uid() AND tm.active));

DROP FUNCTION IF EXISTS public.has_permission_abac(uuid,text,uuid,jsonb);
CREATE OR REPLACE FUNCTION public.has_permission_abac(
  _user_id uuid, _permission text, _tenant_id uuid, _attributes jsonb DEFAULT '{}'::jsonb
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pred record; v_attr_val text;
BEGIN
  IF NOT public.has_permission(_user_id, _permission, _tenant_id, 'tenant', NULL) THEN RETURN false; END IF;
  FOR v_pred IN
    SELECT attribute, operator, values FROM public.rbac_abac_predicates
    WHERE tenant_id = _tenant_id AND permission_id = _permission AND enabled = true
  LOOP
    v_attr_val := _attributes ->> v_pred.attribute;
    IF v_pred.operator = 'in' THEN
      IF v_attr_val IS NULL OR NOT (v_pred.values ? v_attr_val) THEN RETURN false; END IF;
    ELSIF v_pred.operator = 'not_in' THEN
      IF v_attr_val IS NOT NULL AND (v_pred.values ? v_attr_val) THEN RETURN false; END IF;
    ELSIF v_pred.operator = 'equals' THEN
      IF v_attr_val IS DISTINCT FROM (v_pred.values ->> 0) THEN RETURN false; END IF;
    END IF;
  END LOOP;
  RETURN true;
END $$;
REVOKE EXECUTE ON FUNCTION public.has_permission_abac(uuid,text,uuid,jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.has_permission_abac(uuid,text,uuid,jsonb) TO authenticated, service_role;

-- Calendar-aware SLA helper (uses market_calendars.mic_code → market_holidays.calendar_id)
DROP FUNCTION IF EXISTS public.sla_business_due_at(timestamptz,integer,text);
CREATE OR REPLACE FUNCTION public.sla_business_due_at(
  _start timestamptz, _sla_minutes integer, _mic_code text DEFAULT 'XNYS'
) RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_remaining integer := _sla_minutes;
  v_cursor timestamptz := _start;
  v_step integer; v_dow integer; v_is_holiday boolean;
  v_cal_id uuid;
BEGIN
  SELECT id INTO v_cal_id FROM public.market_calendars
   WHERE mic_code = _mic_code AND tenant_id IS NULL
   ORDER BY id LIMIT 1;
  WHILE v_remaining > 0 LOOP
    v_dow := EXTRACT(ISODOW FROM v_cursor)::int;
    v_is_holiday := false;
    IF v_cal_id IS NOT NULL THEN
      SELECT EXISTS(SELECT 1 FROM public.market_holidays
        WHERE calendar_id = v_cal_id AND holiday_date = v_cursor::date) INTO v_is_holiday;
    END IF;
    IF v_dow >= 6 OR v_is_holiday THEN
      v_cursor := date_trunc('day', v_cursor) + interval '1 day';
      CONTINUE;
    END IF;
    v_step := LEAST(v_remaining, 60);
    v_cursor := v_cursor + (v_step || ' minutes')::interval;
    v_remaining := v_remaining - v_step;
  END LOOP;
  RETURN v_cursor;
END $$;
REVOKE EXECUTE ON FUNCTION public.sla_business_due_at(timestamptz,integer,text) FROM public;
GRANT EXECUTE ON FUNCTION public.sla_business_due_at(timestamptz,integer,text) TO authenticated, service_role;

-- Copilot personas
CREATE TABLE IF NOT EXISTS public.copilot_personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  system_prompt text NOT NULL,
  default_prompts jsonb NOT NULL DEFAULT '[]'::jsonb,
  tools_allowlist jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_global boolean NOT NULL DEFAULT true,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.copilot_personas TO authenticated;
GRANT ALL ON public.copilot_personas TO service_role;
ALTER TABLE public.copilot_personas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS persona_select ON public.copilot_personas;
CREATE POLICY persona_select ON public.copilot_personas FOR SELECT TO authenticated
  USING (is_global = true OR (tenant_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = copilot_personas.tenant_id AND tm.user_id = auth.uid() AND tm.active
  )));

INSERT INTO public.copilot_personas (code, name, description, system_prompt, default_prompts, tools_allowlist, is_global)
VALUES (
  'auditor', 'Auditor',
  'Read-only audit persona answering control, evidence and lineage questions strictly from grounded data.',
  'You are the FVI Auditor persona. You may only use read tools. Cite audit_log entries, security_events, recon_runs and KB articles by id. Never propose or perform write actions. If asked for an action, suggest the human approver responsible.',
  '[
    {"label":"List all configuration changes in the last 24 hours with actor and resource","prompt":"List every configuration change (rule edits, schedule edits, permission grants, plugin installs) in the last 24 hours with actor email, tenant, resource type and audit_log id."},
    {"label":"Show all break write-offs with approver chain","prompt":"Show all break write-offs in the last 30 days. Include amount, reason, requester, approver, and the linked audit_log hash."},
    {"label":"Verify audit chain integrity for this tenant","prompt":"Verify the audit chain integrity for this tenant for the last 7 days. Report any broken links and the affected audit_log ids."}
  ]'::jsonb,
  '["search_kb","hybrid_search_kb","get_break","get_reconciliation","count_breaks","runs_summary","sla_at_risk","anomaly_scan","repeat_break_patterns","breaks_aging"]'::jsonb,
  true
)
ON CONFLICT (code) DO UPDATE SET
  name=EXCLUDED.name, description=EXCLUDED.description, system_prompt=EXCLUDED.system_prompt,
  default_prompts=EXCLUDED.default_prompts, tools_allowlist=EXCLUDED.tools_allowlist, updated_at=now();

-- Break taxonomy catalog
CREATE TABLE IF NOT EXISTS public.break_category_catalog (
  code text PRIMARY KEY,
  name text NOT NULL,
  parent_code text REFERENCES public.break_category_catalog(code),
  description text,
  severity_default text NOT NULL DEFAULT 'medium'
);
GRANT SELECT ON public.break_category_catalog TO authenticated, anon;
GRANT ALL ON public.break_category_catalog TO service_role;
ALTER TABLE public.break_category_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bcc_public_read ON public.break_category_catalog;
CREATE POLICY bcc_public_read ON public.break_category_catalog FOR SELECT TO authenticated, anon USING (true);

INSERT INTO public.break_category_catalog (code, name, parent_code, description, severity_default) VALUES
  ('timing','Timing',NULL,'Transaction recorded on different dates on each side','low'),
  ('timing.in_transit','In-transit','timing','Booked one side, settling on the other later','low'),
  ('timing.cut_off','Cut-off','timing','Crossed a daily/period cut-off boundary','low'),
  ('data','Data quality',NULL,'Field or formatting issue','medium'),
  ('data.missing_field','Missing field','data','Required key/identifier missing','medium'),
  ('data.format','Format mismatch','data','Same value represented differently','medium'),
  ('data.duplicate','Duplicate','data','Same item ingested twice','medium'),
  ('economic','Economic difference',NULL,'Real economic mismatch','high'),
  ('economic.amount','Amount mismatch','economic','Amount differs beyond tolerance','high'),
  ('economic.fx','FX/translation','economic','Difference attributable to FX rate','medium'),
  ('economic.fees','Fees/commissions','economic','Difference matches expected fee','medium'),
  ('reference','Reference data',NULL,'Static data inconsistency','medium'),
  ('reference.security','Security master','reference','Security identifier mismatch (ISIN/CUSIP)','medium'),
  ('reference.account','Account master','reference','Account/legal entity mismatch','medium'),
  ('process','Process',NULL,'Workflow / operational cause','medium'),
  ('process.late_booking','Late booking','process','Booking arrived after expected window','low'),
  ('process.manual_intervention','Manual intervention','process','Required manual touch upstream','medium'),
  ('fraud','Suspicious / fraud',NULL,'Potentially fraudulent or out-of-policy','critical'),
  ('unknown','Unknown',NULL,'Cause not yet determined','medium')
ON CONFLICT (code) DO UPDATE SET
  name=EXCLUDED.name, parent_code=EXCLUDED.parent_code,
  description=EXCLUDED.description, severity_default=EXCLUDED.severity_default;

-- Asset-class template seeds (Phase 6)
INSERT INTO public.recon_definition_templates (code, title, summary, asset_class, status, keys, legs, rules, tolerances, sample_fields, install_count) VALUES
  ('equities_trade_vs_confirm','Equities — Trade vs Broker Confirm','Match internal equity trade tickets to broker confirmations on trade date.','equities','published',
   '["trade_id","isin","trade_date"]'::jsonb,
   '[{"name":"OMS Trades"},{"name":"Broker Confirms"}]'::jsonb,
   '[{"kind":"exact","fields":["trade_id","isin","side"]},{"kind":"tolerance","field":"quantity","abs":0},{"kind":"tolerance","field":"price","pct":0.0005}]'::jsonb,
   '{"price_pct":0.0005,"amount_abs":0.01}'::jsonb,
   '["trade_id","isin","ticker","trade_date","settlement_date","side","quantity","price","gross_amount","currency"]'::jsonb,0),
  ('equities_position_vs_custody','Equities — Position vs Custodian','Daily SOD position reconciliation against custody statement.','equities','published',
   '["account_number","isin","position_date"]'::jsonb,
   '[{"name":"Internal Positions"},{"name":"Custodian Positions"}]'::jsonb,
   '[{"kind":"exact","fields":["account_number","isin","position_date"]},{"kind":"tolerance","field":"quantity","abs":0}]'::jsonb,
   '{"quantity_abs":0}'::jsonb,
   '["account_number","isin","position_date","quantity","market_value","currency"]'::jsonb,0),
  ('fi_trade_vs_confirm','Fixed Income — Trade vs Confirm','Match bond/loan trades to dealer confirmations.','fixed_income','published',
   '["trade_id","cusip","trade_date"]'::jsonb,
   '[{"name":"OMS"},{"name":"Dealer Confirm"}]'::jsonb,
   '[{"kind":"exact","fields":["trade_id","cusip"]},{"kind":"tolerance","field":"notional","abs":0},{"kind":"tolerance","field":"yield","abs":0.001}]'::jsonb,
   '{"yield_abs":0.001,"price_pct":0.001}'::jsonb,
   '["trade_id","cusip","isin","trade_date","settlement_date","notional","price","yield","accrued_interest","currency"]'::jsonb,0),
  ('fx_trade_vs_confirm','FX — Trade vs Confirm','Match FX spot/forward trades against counterparty confirmations.','fx','published',
   '["trade_id","ccy_pair","trade_date"]'::jsonb,
   '[{"name":"Internal FX"},{"name":"CP Confirm"}]'::jsonb,
   '[{"kind":"exact","fields":["trade_id","ccy_pair","value_date"]},{"kind":"tolerance","field":"rate","pct":0.00005},{"kind":"tolerance","field":"notional","abs":0}]'::jsonb,
   '{"rate_pct":0.00005}'::jsonb,
   '["trade_id","ccy_pair","trade_date","value_date","notional","rate","counterparty_lei"]'::jsonb,0),
  ('listed_derivs_position','Listed Derivatives — Position vs CCP','Daily position recon against clearing broker / CCP file.','listed_derivatives','published',
   '["account_number","contract_code","position_date"]'::jsonb,
   '[{"name":"Internal Positions"},{"name":"Clearing Broker"}]'::jsonb,
   '[{"kind":"exact","fields":["account_number","contract_code"]},{"kind":"tolerance","field":"long_qty","abs":0},{"kind":"tolerance","field":"short_qty","abs":0}]'::jsonb,
   '{"qty_abs":0}'::jsonb,
   '["account_number","contract_code","position_date","long_qty","short_qty","margin"]'::jsonb,0),
  ('ibor_vs_abor','IBOR vs ABOR','Reconcile investment book of record vs accounting book of record on position+P&L.','multi_asset','published',
   '["account_number","instrument_id","as_of_date"]'::jsonb,
   '[{"name":"IBOR"},{"name":"ABOR"}]'::jsonb,
   '[{"kind":"exact","fields":["account_number","instrument_id"]},{"kind":"tolerance","field":"quantity","abs":0},{"kind":"tolerance","field":"market_value","pct":0.0001}]'::jsonb,
   '{"market_value_pct":0.0001}'::jsonb,
   '["account_number","instrument_id","as_of_date","quantity","cost_basis","market_value","unrealized_pnl"]'::jsonb,0),
  ('trade_lifecycle','Trade Lifecycle — Front-to-Back','Three-way reconciliation: OMS → Middle Office → Back Office (settlement).','multi_asset','published',
   '["trade_id"]'::jsonb,
   '[{"name":"OMS"},{"name":"Middle Office"},{"name":"Back Office"}]'::jsonb,
   '[{"kind":"exact","fields":["trade_id"]},{"kind":"tolerance","field":"quantity","abs":0},{"kind":"tolerance","field":"price","pct":0.0001}]'::jsonb,
   '{"price_pct":0.0001}'::jsonb,
   '["trade_id","stage","quantity","price","status","settlement_status"]'::jsonb,0),
  ('fx_settlement_cls','FX Settlement — CLS vs Internal','Reconcile CLS settlement messages against internal cash movement.','fx','published',
   '["trade_id","value_date"]'::jsonb,
   '[{"name":"CLS"},{"name":"Internal Cash"}]'::jsonb,
   '[{"kind":"exact","fields":["trade_id"]},{"kind":"tolerance","field":"amount","pct":0.00001}]'::jsonb,
   '{"amount_pct":0.00001}'::jsonb,
   '["trade_id","value_date","ccy","amount","status"]'::jsonb,0),
  ('repo_collateral','Repo — Collateral Recon','Repo position and collateral mark vs counterparty file.','fixed_income','published',
   '["repo_id","cusip"]'::jsonb,
   '[{"name":"Internal Repo"},{"name":"CP File"}]'::jsonb,
   '[{"kind":"exact","fields":["repo_id","cusip"]},{"kind":"tolerance","field":"haircut","abs":0.001},{"kind":"tolerance","field":"collateral_value","pct":0.001}]'::jsonb,
   '{"haircut_abs":0.001}'::jsonb,
   '["repo_id","cusip","haircut","collateral_value","start_date","end_date"]'::jsonb,0),
  ('etd_margin','ETD — Initial & Variation Margin','Reconcile clearing broker margin calls vs internal calc.','listed_derivatives','published',
   '["account_number","margin_date"]'::jsonb,
   '[{"name":"Internal Margin"},{"name":"Clearing Broker"}]'::jsonb,
   '[{"kind":"exact","fields":["account_number","margin_date"]},{"kind":"tolerance","field":"im","pct":0.0005},{"kind":"tolerance","field":"vm","pct":0.0005}]'::jsonb,
   '{"margin_pct":0.0005}'::jsonb,
   '["account_number","margin_date","im","vm","total_margin"]'::jsonb,0),
  ('securities_lending','Securities Lending — Open Loans','Open loans by security & counterparty against lending agent statement.','equities','published',
   '["loan_id","isin"]'::jsonb,
   '[{"name":"Internal Loans"},{"name":"Lending Agent"}]'::jsonb,
   '[{"kind":"exact","fields":["loan_id","isin"]},{"kind":"tolerance","field":"quantity","abs":0},{"kind":"tolerance","field":"fee_rate","abs":0.0001}]'::jsonb,
   '{"fee_rate_abs":0.0001}'::jsonb,
   '["loan_id","isin","quantity","fee_rate","start_date","status"]'::jsonb,0),
  ('intra_day_cash_sweep','Cash — Intra-day Sweep','Intra-day cash position vs bank intraday MT942/CAMT.052 file.','cash','published',
   '["account_number","value_date","sweep_window"]'::jsonb,
   '[{"name":"Internal Cash"},{"name":"Bank Intraday"}]'::jsonb,
   '[{"kind":"exact","fields":["account_number","value_date"]},{"kind":"tolerance","field":"balance","pct":0.00001}]'::jsonb,
   '{"balance_pct":0.00001}'::jsonb,
   '["account_number","value_date","sweep_window","balance","currency"]'::jsonb,0)
ON CONFLICT (code) DO UPDATE SET
  title=EXCLUDED.title, summary=EXCLUDED.summary, asset_class=EXCLUDED.asset_class, status=EXCLUDED.status,
  keys=EXCLUDED.keys, legs=EXCLUDED.legs, rules=EXCLUDED.rules,
  tolerances=EXCLUDED.tolerances, sample_fields=EXCLUDED.sample_fields;

-- Predict-break-category helper (matches existing column names)
DROP FUNCTION IF EXISTS public.predict_break_category(uuid);
CREATE OR REPLACE FUNCTION public.predict_break_category(_exception_id uuid)
RETURNS TABLE(category_code text, confidence numeric, model text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.category_code, p.confidence, p.model
  FROM public.break_category_predictions p
  WHERE p.exception_id = _exception_id
  ORDER BY p.created_at DESC, p.confidence DESC
  LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.predict_break_category(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.predict_break_category(uuid) TO authenticated, service_role;

-- updated_at touch trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'master_securities','master_counterparties','master_accounts',
    'recon_event_triggers','recon_rule_simulations','rbac_abac_predicates','copilot_personas'
  ])
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%1$s_touch ON public.%1$s; CREATE TRIGGER trg_%1$s_touch BEFORE UPDATE ON public.%1$s FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();',
      t
    );
  END LOOP;
END $$;
