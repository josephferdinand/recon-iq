
-- ============================================================
-- Reconciliation Template Marketplace consolidation & ERTS
-- ============================================================

-- 1) Extend mkt_templates + mkt_template_versions with scoring
ALTER TABLE public.mkt_templates
  ADD COLUMN IF NOT EXISTS recon_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS governance_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS certification_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spec_valid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS spec_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS refactor_gaps jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS install_mode text NOT NULL DEFAULT 'one_click',
  ADD COLUMN IF NOT EXISTS owner_platform_admin uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS removal_reason text,
  ADD COLUMN IF NOT EXISTS domain_key text;

ALTER TABLE public.mkt_template_versions
  ADD COLUMN IF NOT EXISTS recon_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS governance_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS certification_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spec_valid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS spec_errors jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_mkt_tpl_cert_score ON public.mkt_templates(certification_score DESC);
CREATE INDEX IF NOT EXISTS idx_mkt_tpl_domain_key ON public.mkt_templates(domain_key);

-- 2) Certification events audit log
CREATE TABLE IF NOT EXISTS public.mkt_template_certification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.mkt_templates(id) ON DELETE CASCADE,
  version_id uuid REFERENCES public.mkt_template_versions(id) ON DELETE SET NULL,
  from_status text,
  to_status text NOT NULL,
  reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  spec_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.mkt_template_certification_events TO authenticated;
GRANT ALL ON public.mkt_template_certification_events TO service_role;
ALTER TABLE public.mkt_template_certification_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cert_events_read" ON public.mkt_template_certification_events
  FOR SELECT TO authenticated
  USING (is_platform_admin(auth.uid()));
CREATE POLICY "cert_events_write" ON public.mkt_template_certification_events
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_cert_events_tpl ON public.mkt_template_certification_events(template_id, created_at DESC);

-- 3) Domain presets — canonical scaffolding per BFSI domain
CREATE TABLE IF NOT EXISTS public.mkt_domain_presets (
  domain_key text PRIMARY KEY,
  display_name text NOT NULL,
  preset jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.mkt_domain_presets TO authenticated;
GRANT ALL ON public.mkt_domain_presets TO service_role;
ALTER TABLE public.mkt_domain_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "domain_presets_read" ON public.mkt_domain_presets
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "domain_presets_admin" ON public.mkt_domain_presets
  FOR ALL TO authenticated
  USING (is_platform_admin(auth.uid()))
  WITH CHECK (is_platform_admin(auth.uid()));

-- Seed base preset used by every domain (fallback)
INSERT INTO public.mkt_domain_presets(domain_key, display_name, preset) VALUES
('default', 'Default BFSI Reconciliation Preset', jsonb_build_object(
  'data_model', jsonb_build_object(
    'sources', jsonb_build_array(
      jsonb_build_object('id','source_a','system','SYSTEM_A','entity','transactions',
        'mandatory_fields', jsonb_build_array('id','trade_date','amount','currency','counterparty'),
        'validation_rules', jsonb_build_array('amount_numeric','currency_iso4217','date_iso8601'),
        'dq_controls', jsonb_build_array('not_null_key','duplicate_check')),
      jsonb_build_object('id','source_b','system','SYSTEM_B','entity','ledger_entries',
        'mandatory_fields', jsonb_build_array('id','post_date','amount','currency','account'),
        'validation_rules', jsonb_build_array('amount_numeric','currency_iso4217','date_iso8601'),
        'dq_controls', jsonb_build_array('not_null_key','duplicate_check'))
    ),
    'targets', jsonb_build_array(jsonb_build_object('id','recon_output','system','FVI','entity','recon_matches')),
    'master_data', jsonb_build_array('accounts','counterparties','currencies','calendars')
  ),
  'matching', jsonb_build_object(
    'engine','recon_matching_v2',
    'rules', jsonb_build_array(
      jsonb_build_object('id','r_exact','type','exact','keys', jsonb_build_array('id')),
      jsonb_build_object('id','r_composite','type','composite','keys', jsonb_build_array('trade_date','amount','counterparty')),
      jsonb_build_object('id','r_tolerance','type','tolerance','keys', jsonb_build_array('trade_date','amount'),
        'tolerances', jsonb_build_object('amount', 0.01, 'date_days', 1)),
      jsonb_build_object('id','r_fuzzy','type','fuzzy','keys', jsonb_build_array('counterparty','narrative'), 'threshold', 0.85),
      jsonb_build_object('id','r_ai_assisted','type','ai_assisted','ai_binding','ai.matching.recommendations')
    )
  ),
  'reconciliation', jsonb_build_object(
    'balance_validations', jsonb_build_array('sum_check','count_check'),
    'break_detection', jsonb_build_array('unmatched','partial','duplicate'),
    'aging', jsonb_build_object('buckets', jsonb_build_array('0-1','2-7','8-30','30+')),
    'materiality', jsonb_build_object('threshold_ccy','USD','amount', 10000),
    'risk_controls', jsonb_build_array('four_eyes_signoff','segregation_of_duties'),
    'alerts', jsonb_build_array('sla_breach','aging_bucket_30_plus','materiality_exceeded'),
    'approvals', jsonb_build_array('maker','checker','approver')
  ),
  'exceptions', jsonb_build_object(
    'break_categories', jsonb_build_array('unmatched','amount_diff','date_diff','duplicate','missing','fx_diff'),
    'workflows', jsonb_build_array(
      jsonb_build_object('id','wf_default','from','open','to','investigating','role','analyst'),
      jsonb_build_object('id','wf_resolve','from','investigating','to','resolved','role','analyst'),
      jsonb_build_object('id','wf_close','from','resolved','to','closed','role','approver')
    ),
    'routing', jsonb_build_array('by_category','by_counterparty','by_amount_band'),
    'escalations', jsonb_build_array('l1_24h','l2_48h','l3_72h'),
    'ownership', jsonb_build_array('primary_analyst','backup_analyst','team_lead'),
    'sla_ref','sla.default',
    'closure', jsonb_build_array('evidence_required','approver_signoff')
  ),
  'reporting', jsonb_build_object(
    'dashboards', jsonb_build_array('operational_summary','open_breaks','aging','trend'),
    'summaries', jsonb_build_array('daily','weekly','monthly'),
    'regulatory_reports', jsonb_build_array(),
    'audit_reports', jsonb_build_array('control_evidence','maker_checker_log'),
    'executive_dashboards', jsonb_build_array('kpi_overview','risk_heatmap')
  ),
  'ai', jsonb_build_object(
    'mapping', jsonb_build_object('auto_field',true,'attribute',true,'structure_analysis',true),
    'matching', jsonb_build_object('recommendations',true,'confidence',true,'optimization',true),
    'reconciliation', jsonb_build_object('auto_recon',true,'suggested_matches',true,'break_prediction',true),
    'exceptions', jsonb_build_object('rca',true,'classification',true,'resolution_reco',true),
    'insights', jsonb_build_object('trends',true,'anomalies',true,'risk',true),
    'recommendations', jsonb_build_object('templates',true,'workflows',true,'regulatory',true)
  ),
  'install', jsonb_build_object('mode','one_click','prerequisites', jsonb_build_array(), 'post_install_hooks', jsonb_build_array('bind_default_schedule','wire_default_dashboards')),
  'governance', jsonb_build_object('rbac_roles_required', jsonb_build_array('tenant_admin','recon_operator'), 'rls_scope','tenant', 'approval_workflow_ref','governance.default', 'audit_binding', true)
))
ON CONFLICT (domain_key) DO UPDATE SET preset = EXCLUDED.preset, updated_at = now();

-- Domain-specific overrides for the seven biggest BFSI domains
INSERT INTO public.mkt_domain_presets(domain_key, display_name, preset) VALUES
('regulatory', 'Regulatory Compliance Pack Preset', jsonb_build_object(
  'reconciliation', jsonb_build_object('risk_controls', jsonb_build_array('four_eyes_signoff','segregation_of_duties','worm_evidence','attestation_required')),
  'reporting', jsonb_build_object('regulatory_reports', jsonb_build_array('control_monitor','attestation_log','regulator_filing_evidence')),
  'governance', jsonb_build_object('rbac_roles_required', jsonb_build_array('tenant_admin','compliance_officer','auditor'), 'rls_scope','tenant', 'audit_binding', true, 'worm_binding', true)
)),
('payments', 'Payments & Cards Preset', jsonb_build_object(
  'matching', jsonb_build_object('rules', jsonb_build_array(
    jsonb_build_object('id','r_arn','type','exact','keys', jsonb_build_array('arn')),
    jsonb_build_object('id','r_auth_id','type','composite','keys', jsonb_build_array('auth_id','amount','currency'))))
)),
('aml', 'AML & Financial Crime Preset', jsonb_build_object(
  'exceptions', jsonb_build_object('break_categories', jsonb_build_array('sanction_hit','pep_match','structuring','layering','smurfing','round_tripping','cross_border')),
  'governance', jsonb_build_object('rbac_roles_required', jsonb_build_array('tenant_admin','aml_officer','mlro'), 'audit_binding', true)
)),
('capital_markets', 'Capital Markets Preset', jsonb_build_object(
  'matching', jsonb_build_object('rules', jsonb_build_array(
    jsonb_build_object('id','r_trade_id','type','exact','keys', jsonb_build_array('trade_id')),
    jsonb_build_object('id','r_isin_qty','type','composite','keys', jsonb_build_array('isin','qty','trade_date')))))),
('treasury', 'Treasury Preset', jsonb_build_object(
  'reconciliation', jsonb_build_object('balance_validations', jsonb_build_array('nostro_balance','cash_position','fx_position')))),
('gl', 'General Ledger Preset', jsonb_build_object(
  'matching', jsonb_build_object('rules', jsonb_build_array(
    jsonb_build_object('id','r_gl_key','type','composite','keys', jsonb_build_array('account','post_date','amount','currency')))))),
('digital_assets','Digital Assets Preset', jsonb_build_object(
  'matching', jsonb_build_object('rules', jsonb_build_array(
    jsonb_build_object('id','r_txhash','type','exact','keys', jsonb_build_array('tx_hash'))))))
ON CONFLICT (domain_key) DO UPDATE SET preset = EXCLUDED.preset, updated_at = now();

-- 4) ERTS scaffold: deep-merge preset into spec (spec wins on conflict)
CREATE OR REPLACE FUNCTION public.jsonb_deep_merge(a jsonb, b jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN a IS NULL THEN b
    WHEN b IS NULL THEN a
    WHEN jsonb_typeof(a)='object' AND jsonb_typeof(b)='object' THEN
      (SELECT jsonb_object_agg(k, CASE
        WHEN a ? k AND b ? k AND jsonb_typeof(a->k)='object' AND jsonb_typeof(b->k)='object'
          THEN public.jsonb_deep_merge(a->k, b->k)
        WHEN a ? k THEN a->k
        ELSE b->k END)
       FROM (SELECT jsonb_object_keys(a) UNION SELECT jsonb_object_keys(b)) t(k))
    ELSE COALESCE(a, b)
  END;
$$;

CREATE OR REPLACE FUNCTION public.mkt_domain_scaffold(p_domain text, p_spec jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE
  base jsonb;
  dom jsonb;
BEGIN
  SELECT preset INTO base FROM public.mkt_domain_presets WHERE domain_key='default';
  SELECT preset INTO dom FROM public.mkt_domain_presets WHERE domain_key = p_domain;
  IF base IS NULL THEN base := '{}'::jsonb; END IF;
  IF dom IS NOT NULL THEN base := public.jsonb_deep_merge(dom, base); END IF;
  RETURN public.jsonb_deep_merge(COALESCE(p_spec,'{}'::jsonb), base);
END $$;

-- 5) ERTS validator + scoring
CREATE OR REPLACE FUNCTION public.validate_erts(p_spec jsonb, p_domain text DEFAULT 'default')
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE
  errors jsonb := '[]'::jsonb;
  recon_pts int := 0;
  ai_pts int := 0;
  gov_pts int := 0;
  has_sources bool; has_targets bool; has_rules bool; has_workflows bool; has_dash bool; has_reg bool;
  ai_keys text[] := ARRAY['mapping','matching','reconciliation','exceptions','insights','recommendations'];
  k text; ai_count int := 0;
BEGIN
  IF p_spec IS NULL OR jsonb_typeof(p_spec) <> 'object' THEN
    RETURN jsonb_build_object('valid',false,'errors',jsonb_build_array('spec_missing_or_not_object'),
      'scores', jsonb_build_object('recon',0,'ai',0,'governance',0,'certification',0));
  END IF;

  has_sources := jsonb_typeof(p_spec #> '{data_model,sources}') = 'array' AND jsonb_array_length(p_spec #> '{data_model,sources}') > 0;
  has_targets := jsonb_typeof(p_spec #> '{data_model,targets}') = 'array' AND jsonb_array_length(p_spec #> '{data_model,targets}') > 0;
  has_rules := jsonb_typeof(p_spec #> '{matching,rules}') = 'array' AND jsonb_array_length(p_spec #> '{matching,rules}') > 0;
  has_workflows := jsonb_typeof(p_spec #> '{exceptions,workflows}') = 'array' AND jsonb_array_length(p_spec #> '{exceptions,workflows}') > 0;
  has_dash := jsonb_typeof(p_spec #> '{reporting,dashboards}') = 'array' AND jsonb_array_length(p_spec #> '{reporting,dashboards}') > 0;
  has_reg := (p_spec #> '{reporting,regulatory_reports}') IS NOT NULL;

  IF NOT has_sources THEN errors := errors || to_jsonb('missing:data_model.sources'::text); END IF;
  IF NOT has_targets THEN errors := errors || to_jsonb('missing:data_model.targets'::text); END IF;
  IF NOT has_rules THEN errors := errors || to_jsonb('missing:matching.rules'::text); END IF;
  IF NOT has_workflows THEN errors := errors || to_jsonb('missing:exceptions.workflows'::text); END IF;
  IF NOT has_dash THEN errors := errors || to_jsonb('missing:reporting.dashboards'::text); END IF;

  recon_pts := (CASE WHEN has_sources THEN 20 ELSE 0 END)
             + (CASE WHEN has_targets THEN 15 ELSE 0 END)
             + (CASE WHEN has_rules THEN 30 ELSE 0 END)
             + (CASE WHEN has_workflows THEN 20 ELSE 0 END)
             + (CASE WHEN has_dash THEN 15 ELSE 0 END);

  FOREACH k IN ARRAY ai_keys LOOP
    IF (p_spec #> ARRAY['ai',k]) IS NOT NULL AND jsonb_typeof(p_spec #> ARRAY['ai',k]) = 'object' THEN
      ai_count := ai_count + 1;
    END IF;
  END LOOP;
  ai_pts := LEAST(100, (ai_count * 100) / 6);

  gov_pts := (CASE WHEN (p_spec #> '{governance,rbac_roles_required}') IS NOT NULL THEN 25 ELSE 0 END)
           + (CASE WHEN (p_spec #> '{governance,rls_scope}') IS NOT NULL THEN 25 ELSE 0 END)
           + (CASE WHEN (p_spec #> '{governance,audit_binding}')::text = 'true' THEN 25 ELSE 0 END)
           + (CASE WHEN (p_spec #> '{reconciliation,risk_controls}') IS NOT NULL THEN 25 ELSE 0 END);

  RETURN jsonb_build_object(
    'valid', has_sources AND has_targets AND has_rules AND has_workflows AND has_dash,
    'errors', errors,
    'scores', jsonb_build_object(
      'recon', recon_pts,
      'ai', ai_pts,
      'governance', gov_pts,
      'certification', ((recon_pts * 5) + (ai_pts * 3) + (gov_pts * 2)) / 10
    )
  );
END $$;

-- 6) Version trigger: validate + score + roll up to parent
CREATE OR REPLACE FUNCTION public.trg_mkt_version_validate()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  v jsonb; s jsonb;
  dom text;
BEGIN
  SELECT COALESCE(t.domain_key, 'default') INTO dom FROM public.mkt_templates t WHERE t.id = NEW.template_id;
  s := public.validate_erts(NEW.spec, dom);
  NEW.spec_valid := (s->>'valid')::boolean;
  NEW.spec_errors := s->'errors';
  NEW.recon_score := (s#>>'{scores,recon}')::int;
  NEW.ai_score := (s#>>'{scores,ai}')::int;
  NEW.governance_score := (s#>>'{scores,governance}')::int;
  NEW.certification_score := (s#>>'{scores,certification}')::int;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS mkt_version_validate ON public.mkt_template_versions;
CREATE TRIGGER mkt_version_validate
  BEFORE INSERT OR UPDATE OF spec ON public.mkt_template_versions
  FOR EACH ROW EXECUTE FUNCTION public.trg_mkt_version_validate();

CREATE OR REPLACE FUNCTION public.trg_mkt_version_rollup()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  UPDATE public.mkt_templates
     SET recon_score = NEW.recon_score,
         ai_score = NEW.ai_score,
         governance_score = NEW.governance_score,
         certification_score = NEW.certification_score,
         spec_valid = NEW.spec_valid,
         spec_errors = NEW.spec_errors,
         updated_at = now()
   WHERE id = NEW.template_id AND (current_version_id = NEW.id OR current_version_id IS NULL);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS mkt_version_rollup ON public.mkt_template_versions;
CREATE TRIGGER mkt_version_rollup
  AFTER INSERT OR UPDATE ON public.mkt_template_versions
  FOR EACH ROW EXECUTE FUNCTION public.trg_mkt_version_rollup();

-- 7) Derive domain_key on templates from category / pack_type
UPDATE public.mkt_templates t SET domain_key = CASE
  WHEN t.pack_type = 'regulatory' THEN 'regulatory'
  WHEN c.slug ILIKE '%payment%' OR c.slug ILIKE '%card%' THEN 'payments'
  WHEN c.slug ILIKE '%aml%' OR c.slug ILIKE '%kyc%' OR c.slug ILIKE '%financial-crime%' THEN 'aml'
  WHEN c.slug ILIKE '%capital-markets%' OR c.slug ILIKE '%securities%' OR c.slug ILIKE '%derivatives%' OR c.slug ILIKE '%custody%' OR c.slug ILIKE '%trade%' THEN 'capital_markets'
  WHEN c.slug ILIKE '%treasury%' OR c.slug ILIKE '%nostro%' OR c.slug ILIKE '%vostro%' OR c.slug ILIKE '%fx%' OR c.slug ILIKE '%foreign-exchange%' THEN 'treasury'
  WHEN c.slug ILIKE '%general-ledger%' OR c.slug ILIKE '%gl%' OR c.slug ILIKE '%intercompany%' THEN 'gl'
  WHEN c.slug ILIKE '%digital%' OR c.slug ILIKE '%crypto%' THEN 'digital_assets'
  ELSE 'default'
END
FROM public.mkt_template_categories c
WHERE t.category_id = c.id;

UPDATE public.mkt_templates SET domain_key='default' WHERE domain_key IS NULL;

-- 8) Backfill: scaffold every existing version spec with its domain preset
UPDATE public.mkt_template_versions v
   SET spec = public.mkt_domain_scaffold(t.domain_key, v.spec)
  FROM public.mkt_templates t
 WHERE v.template_id = t.id;

-- Triggers above will re-score on the UPDATE. Now roll up to parents that had no current_version_id.
UPDATE public.mkt_templates t SET current_version_id = v.id
  FROM (SELECT DISTINCT ON (template_id) template_id, id FROM public.mkt_template_versions ORDER BY template_id, created_at DESC) v
 WHERE v.template_id = t.id AND t.current_version_id IS NULL;

-- Recompute parent scores from current version
UPDATE public.mkt_templates t
   SET recon_score = v.recon_score,
       ai_score = v.ai_score,
       governance_score = v.governance_score,
       certification_score = v.certification_score,
       spec_valid = v.spec_valid,
       spec_errors = v.spec_errors
  FROM public.mkt_template_versions v
 WHERE v.id = t.current_version_id;

-- 9) Rationalize: certified templates that no longer meet threshold get demoted
UPDATE public.mkt_templates
   SET certification = 'review',
       refactor_gaps = spec_errors
 WHERE certification = 'certified' AND certification_score < 70;

-- Templates with no sources at all after scaffolding → archive
UPDATE public.mkt_templates
   SET certification = 'archived',
       retired_at = now(),
       removal_reason = 'No executable sources or matching rules; not aligned with reconciliation product scope.'
 WHERE spec_valid = false AND certification_score < 30;

-- 10) Bring the 3 legacy marketplace_listings entries into mkt_templates
INSERT INTO public.mkt_templates (slug, title, summary, description, pack_type, certification, visibility, license, tags, domain_key)
SELECT
  'legacy-' || l.slug,
  l.title,
  l.summary,
  l.description,
  'industry'::mkt_tpl_pack_type,
  CASE l.status
    WHEN 'published' THEN 'certified'::mkt_tpl_certification
    WHEN 'draft' THEN 'draft'::mkt_tpl_certification
    ELSE 'archived'::mkt_tpl_certification END,
  'public'::mkt_tpl_visibility,
  'free'::mkt_tpl_license,
  COALESCE(l.tags, '{}'::text[]),
  'default'
FROM public.marketplace_listings l
WHERE l.kind = 'recon_template'
  AND NOT EXISTS (SELECT 1 FROM public.mkt_templates m WHERE m.slug = 'legacy-' || l.slug)
ON CONFLICT (slug) DO NOTHING;

-- 11) Certification report view
CREATE OR REPLACE VIEW public.v_mkt_certification_report AS
SELECT
  t.id,
  t.slug,
  t.title,
  c.name AS category,
  t.domain_key,
  t.pack_type::text,
  t.certification::text,
  t.spec_valid,
  t.certification_score,
  t.recon_score,
  t.ai_score,
  t.governance_score,
  t.refactor_gaps,
  t.removal_reason,
  t.install_count,
  t.updated_at
FROM public.mkt_templates t
LEFT JOIN public.mkt_template_categories c ON c.id = t.category_id;

GRANT SELECT ON public.v_mkt_certification_report TO authenticated;
