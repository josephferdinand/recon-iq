-- Phase 3 & 7 platform tables + Phase 1 regulatory pack seeds (retry — fixed regulatory_pack_catalog columns)

-- platform_slo_catalog
CREATE TABLE IF NOT EXISTS public.platform_slo_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text NOT NULL,
  signal text NOT NULL,
  objective_pct numeric(6,3) NOT NULL,
  window_days integer NOT NULL DEFAULT 30,
  latency_ms_target integer,
  error_budget_pct numeric(6,3),
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service, signal)
);
GRANT SELECT ON public.platform_slo_catalog TO authenticated;
GRANT ALL ON public.platform_slo_catalog TO service_role;
ALTER TABLE public.platform_slo_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read slo catalog" ON public.platform_slo_catalog
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "platform admin write slo catalog" ON public.platform_slo_catalog
  FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- platform_slo_measurements
CREATE TABLE IF NOT EXISTS public.platform_slo_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slo_id uuid NOT NULL REFERENCES public.platform_slo_catalog(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL DEFAULT now(),
  sli_value numeric(10,4) NOT NULL,
  window_seconds integer NOT NULL DEFAULT 300,
  sample_count integer,
  breach boolean NOT NULL DEFAULT false,
  context jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_platform_slo_measurements_slo_time
  ON public.platform_slo_measurements(slo_id, observed_at DESC);
GRANT SELECT ON public.platform_slo_measurements TO authenticated;
GRANT ALL ON public.platform_slo_measurements TO service_role;
ALTER TABLE public.platform_slo_measurements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read slo measurements" ON public.platform_slo_measurements
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "platform admin write slo measurements" ON public.platform_slo_measurements
  FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- platform_chaos_calendar
CREATE TABLE IF NOT EXISTS public.platform_chaos_calendar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drill_code text NOT NULL,
  title text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  cadence text NOT NULL DEFAULT 'weekly',
  blast_radius text NOT NULL DEFAULT 'single-component',
  tenant_impact text NOT NULL DEFAULT 'none',
  runbook_url text,
  status text NOT NULL DEFAULT 'scheduled',
  outcome text,
  scheduled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (drill_code, scheduled_for)
);
CREATE INDEX IF NOT EXISTS ix_platform_chaos_calendar_when
  ON public.platform_chaos_calendar(scheduled_for DESC);
GRANT SELECT ON public.platform_chaos_calendar TO authenticated;
GRANT ALL ON public.platform_chaos_calendar TO service_role;
ALTER TABLE public.platform_chaos_calendar ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read chaos calendar" ON public.platform_chaos_calendar
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "platform admin write chaos calendar" ON public.platform_chaos_calendar
  FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- platform_adr_registry
CREATE TABLE IF NOT EXISTS public.platform_adr_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adr_number integer NOT NULL UNIQUE,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'proposed',
  doc_path text NOT NULL,
  deciders text[],
  linked_pr text,
  evidence_pack text,
  superseded_by integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.platform_adr_registry TO authenticated;
GRANT ALL ON public.platform_adr_registry TO service_role;
ALTER TABLE public.platform_adr_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read adr registry" ON public.platform_adr_registry
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "platform admin write adr registry" ON public.platform_adr_registry
  FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- updated_at trigger helper (idempotent)
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_slo_catalog_touch ON public.platform_slo_catalog;
CREATE TRIGGER trg_slo_catalog_touch BEFORE UPDATE ON public.platform_slo_catalog
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS trg_chaos_calendar_touch ON public.platform_chaos_calendar;
CREATE TRIGGER trg_chaos_calendar_touch BEFORE UPDATE ON public.platform_chaos_calendar
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS trg_adr_registry_touch ON public.platform_adr_registry;
CREATE TRIGGER trg_adr_registry_touch BEFORE UPDATE ON public.platform_adr_registry
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Seed baseline SLO catalog
INSERT INTO public.platform_slo_catalog (service, signal, objective_pct, window_days, latency_ms_target, error_budget_pct, description)
VALUES
  ('auth.signin',              'availability', 99.95, 30, NULL, 0.05, 'Sign-in success rate'),
  ('recon.run.start',          'latency_p95',  95.00,  7, 1200, 5.00, 'p95 latency for starting a reconciliation run'),
  ('break.list',               'latency_p95',  95.00,  7,  400, 5.00, 'p95 latency for break list queries'),
  ('break.detail',             'latency_p95',  95.00,  7,  350, 5.00, 'p95 latency for break detail fetch'),
  ('match.action',             'latency_p95',  95.00,  7,  600, 5.00, 'p95 latency for match actions'),
  ('digital_twin.stats',       'latency_p95',  95.00,  7,  500, 5.00, 'p95 latency for digital twin stats RPC'),
  ('loans.exposure.list',      'latency_p95',  95.00,  7,  700, 5.00, 'p95 latency for loans exposure list'),
  ('soc2.bundle.export',       'latency_p95',  95.00, 30, 4000, 5.00, 'p95 latency for SOC 2 bundle export'),
  ('copilot.first_token',      'latency_p95',  95.00,  7, 1500, 5.00, 'p95 latency for Copilot first token'),
  ('webhook.outbox.freshness', 'lag_seconds',  95.00,  7,   60, 5.00, 'webhook outbox drain lag')
ON CONFLICT (service, signal) DO NOTHING;

-- Seed additional regulatory packs (columns: code, regulator, jurisdiction, version, fields, status)
INSERT INTO public.regulatory_pack_catalog (code, regulator, jurisdiction, version, fields, status)
SELECT * FROM (VALUES
  ('fca-cass-v1',     'FCA',   'UK', '1.0.0',
    '{"title":"FCA CASS 6.6 / 7.15","description":"Client money & assets — daily internal reconciliation & external client-money reconciliation.","controls":["CASS 6.6.34R","CASS 7.15.20R","CASS 7.15.31R"]}'::jsonb,
    'published'),
  ('mas-trm-v1',      'MAS',   'SG', '1.0.0',
    '{"title":"MAS TRM 6.1.4 / 8.1","description":"Technology Risk Management guidelines — ICT resilience & change management evidence.","controls":["TRM 6.1.4","TRM 6.4","TRM 8.1"]}'::jsonb,
    'published'),
  ('bafin-marisk-v1', 'BaFin', 'DE', '1.0.0',
    '{"title":"BaFin MaRisk AT 9 / 7.2","description":"Minimum requirements for risk management — outsourcing & IT systems evidence.","controls":["MaRisk AT 9","MaRisk AT 7.2","MaRisk BTR 4"]}'::jsonb,
    'published')
) AS s(code, regulator, jurisdiction, version, fields, status)
WHERE NOT EXISTS (
  SELECT 1 FROM public.regulatory_pack_catalog c WHERE c.code = s.code
);

-- Seed ADR registry with the two ADRs shipped this batch
INSERT INTO public.platform_adr_registry (adr_number, title, status, doc_path, deciders)
VALUES
  (0, 'ADR template', 'accepted', 'docs/adr/000_template.md', ARRAY['platform-engineering']::text[]),
  (1, 'Seven-phase enterprise transformation (2026-H2)', 'accepted', 'docs/adr/001_seven_phase_transformation.md', ARRAY['ARB','CTO','CISO','VP-Product']::text[])
ON CONFLICT (adr_number) DO NOTHING;
