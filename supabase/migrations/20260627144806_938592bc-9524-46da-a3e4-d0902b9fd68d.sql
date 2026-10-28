
-- =====================================================
-- Batch B: ageing, EOD sign-off, stop-a-run, home, wizard
-- =====================================================

CREATE TABLE public.exception_ageing_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  bucket TEXT NOT NULL CHECK (bucket IN ('0-1d','2-5d','6-15d','16-30d','30d+')),
  count INTEGER NOT NULL DEFAULT 0,
  amount NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_age_snap_tenant_date ON public.exception_ageing_snapshots(tenant_id, snapshot_date DESC);
GRANT SELECT, INSERT ON public.exception_ageing_snapshots TO authenticated;
GRANT ALL ON public.exception_ageing_snapshots TO service_role;
ALTER TABLE public.exception_ageing_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY age_select ON public.exception_ageing_snapshots FOR SELECT
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY age_insert ON public.exception_ageing_snapshots FOR INSERT
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));

CREATE TABLE public.eod_signoffs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_date DATE NOT NULL,
  scope TEXT NOT NULL DEFAULT 'tenant',
  definition_id UUID,
  prepared_by UUID,
  prepared_at TIMESTAMPTZ,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','prepared','approved','rejected')),
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_eod_period ON public.eod_signoffs(tenant_id, period_date, COALESCE(definition_id, '00000000-0000-0000-0000-000000000000'::uuid));
GRANT SELECT, INSERT, UPDATE ON public.eod_signoffs TO authenticated;
GRANT ALL ON public.eod_signoffs TO service_role;
ALTER TABLE public.eod_signoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY eod_select ON public.eod_signoffs FOR SELECT
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY eod_write ON public.eod_signoffs FOR INSERT
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY eod_update ON public.eod_signoffs FOR UPDATE
  USING (public.is_tenant_member(auth.uid(), tenant_id))
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));

CREATE TABLE public.run_kill_switches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_id UUID NOT NULL,
  requested_by UUID,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','acknowledged','stopped','ignored'))
);
GRANT SELECT, INSERT, UPDATE ON public.run_kill_switches TO authenticated;
GRANT ALL ON public.run_kill_switches TO service_role;
ALTER TABLE public.run_kill_switches ENABLE ROW LEVEL SECURITY;
CREATE POLICY kill_select ON public.run_kill_switches FOR SELECT
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY kill_write ON public.run_kill_switches FOR INSERT
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY kill_update ON public.run_kill_switches FOR UPDATE
  USING (public.is_tenant_member(auth.uid(), tenant_id))
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));

CREATE TABLE public.home_layouts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  layout JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_home_layout ON public.home_layouts(user_id, tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.home_layouts TO authenticated;
GRANT ALL ON public.home_layouts TO service_role;
ALTER TABLE public.home_layouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY home_owner ON public.home_layouts FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.process_wizard_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,
  current_step INTEGER NOT NULL DEFAULT 1,
  total_steps INTEGER NOT NULL DEFAULT 5,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','abandoned')),
  started_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.process_wizard_runs TO authenticated;
GRANT ALL ON public.process_wizard_runs TO service_role;
ALTER TABLE public.process_wizard_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY pwz_select ON public.process_wizard_runs FOR SELECT
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY pwz_write ON public.process_wizard_runs FOR INSERT
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY pwz_update ON public.process_wizard_runs FOR UPDATE
  USING (public.is_tenant_member(auth.uid(), tenant_id))
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));

-- =====================================================
-- Batch C: status page, predictive labels
-- =====================================================

CREATE TABLE public.status_incidents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT,
  severity TEXT NOT NULL DEFAULT 'minor' CHECK (severity IN ('maintenance','minor','major','critical')),
  status TEXT NOT NULL DEFAULT 'investigating' CHECK (status IN ('investigating','identified','monitoring','resolved')),
  component TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.status_incidents TO authenticated;
GRANT ALL ON public.status_incidents TO service_role;
ALTER TABLE public.status_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY status_select ON public.status_incidents FOR SELECT USING (true);
CREATE POLICY status_admin ON public.status_incidents FOR ALL
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE TABLE public.predictive_labels (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  exception_id UUID,
  label TEXT NOT NULL,
  confidence NUMERIC NOT NULL DEFAULT 0,
  model TEXT,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  accepted BOOLEAN,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pl_tenant ON public.predictive_labels(tenant_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.predictive_labels TO authenticated;
GRANT ALL ON public.predictive_labels TO service_role;
ALTER TABLE public.predictive_labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY pl_select ON public.predictive_labels FOR SELECT
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY pl_write ON public.predictive_labels FOR INSERT
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY pl_update ON public.predictive_labels FOR UPDATE
  USING (public.is_tenant_member(auth.uid(), tenant_id))
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));
