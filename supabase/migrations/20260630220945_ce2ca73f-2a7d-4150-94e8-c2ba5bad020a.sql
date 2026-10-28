
CREATE TABLE public.llm_model_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  primary_provider_id UUID REFERENCES public.llm_providers(id) ON DELETE SET NULL,
  fallback1_provider_id UUID REFERENCES public.llm_providers(id) ON DELETE SET NULL,
  fallback2_provider_id UUID REFERENCES public.llm_providers(id) ON DELETE SET NULL,
  routing_strategy TEXT NOT NULL DEFAULT 'priority'
    CHECK (routing_strategy IN ('priority','availability','latency','cost','performance','manual','policy')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, feature_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.llm_model_routes TO authenticated;
GRANT ALL ON public.llm_model_routes TO service_role;
ALTER TABLE public.llm_model_routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant members read routes"
  ON public.llm_model_routes FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "tenant admins manage routes"
  ON public.llm_model_routes FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));

CREATE TABLE public.llm_failover_test_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  route_id UUID REFERENCES public.llm_model_routes(id) ON DELETE SET NULL,
  scenario TEXT NOT NULL
    CHECK (scenario IN ('primary','fallback1','fallback2','health','connectivity','auth','throughput','latency','full_failover','rate_limit','timeout')),
  provider_used UUID REFERENCES public.llm_providers(id) ON DELETE SET NULL,
  model_used TEXT,
  status TEXT NOT NULL CHECK (status IN ('pass','fail','error','skipped')),
  latency_ms INT,
  tokens_in INT,
  tokens_out INT,
  cost_usd NUMERIC(12,6),
  error_message TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  tested_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.llm_failover_test_runs TO authenticated;
GRANT ALL ON public.llm_failover_test_runs TO service_role;
ALTER TABLE public.llm_failover_test_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant members read test runs"
  ON public.llm_failover_test_runs FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "tenant admins insert test runs"
  ON public.llm_failover_test_runs FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));
CREATE INDEX llm_failover_test_runs_tenant_idx ON public.llm_failover_test_runs (tenant_id, created_at DESC);

CREATE TABLE public.governance_approval_settings (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  dual_approval_enabled BOOLEAN NOT NULL DEFAULT false,
  four_eyes_enabled BOOLEAN NOT NULL DEFAULT false,
  governance_review_enabled BOOLEAN NOT NULL DEFAULT false,
  security_review_enabled BOOLEAN NOT NULL DEFAULT false,
  compliance_review_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.governance_approval_settings TO authenticated;
GRANT ALL ON public.governance_approval_settings TO service_role;
ALTER TABLE public.governance_approval_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant members read approval settings"
  ON public.governance_approval_settings FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "tenant admins manage approval settings"
  ON public.governance_approval_settings FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));

CREATE TRIGGER trg_llm_model_routes_touch BEFORE UPDATE ON public.llm_model_routes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_governance_approval_settings_touch BEFORE UPDATE ON public.governance_approval_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
