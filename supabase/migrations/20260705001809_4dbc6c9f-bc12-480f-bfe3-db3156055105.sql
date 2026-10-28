
CREATE TABLE IF NOT EXISTS public.soc2_evidence_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id TEXT NOT NULL UNIQUE,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('tenant','platform')),
  requester_user_id UUID NOT NULL,
  requester_email TEXT,
  window_days INT NOT NULL,
  window_since TIMESTAMPTZ NOT NULL,
  row_count INT NOT NULL DEFAULT 0,
  category_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  storage_bucket TEXT NOT NULL DEFAULT 'soc2-evidence',
  storage_path TEXT NOT NULL,
  bytes INT,
  sha256 TEXT,
  audit_log_id UUID,
  expires_at TIMESTAMPTZ NOT NULL,
  download_count INT NOT NULL DEFAULT 0,
  last_downloaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_soc2_bundles_created ON public.soc2_evidence_bundles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_soc2_bundles_tenant ON public.soc2_evidence_bundles(tenant_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.soc2_evidence_bundles TO authenticated;
GRANT ALL ON public.soc2_evidence_bundles TO service_role;

ALTER TABLE public.soc2_evidence_bundles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "soc2_bundles_platform_admin_all" ON public.soc2_evidence_bundles
  FOR ALL TO authenticated
  USING (public.has_platform_role(auth.uid(), 'platform_admin'::platform_role))
  WITH CHECK (public.has_platform_role(auth.uid(), 'platform_admin'::platform_role));

CREATE POLICY "soc2_bundles_tenant_admin_read" ON public.soc2_evidence_bundles
  FOR SELECT TO authenticated
  USING (tenant_id IS NOT NULL AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));

CREATE TABLE IF NOT EXISTS public.erp_connector_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  connector_kind TEXT NOT NULL CHECK (connector_kind IN ('sap','oracle','tally','finacle','flexcube')),
  display_name TEXT NOT NULL,
  auth_method TEXT NOT NULL CHECK (auth_method IN ('oauth2','api_key','basic','service_account','ssh_key')),
  base_url TEXT,
  environment TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox','uat','production')),
  credential_vault_secret_id UUID,
  scopes TEXT[],
  extra_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','testing','active','error','disabled')),
  last_test_at TIMESTAMPTZ,
  last_test_result JSONB,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, connector_kind, environment)
);
CREATE INDEX IF NOT EXISTS idx_erp_conn_tenant ON public.erp_connector_configs(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.erp_connector_configs TO authenticated;
GRANT ALL ON public.erp_connector_configs TO service_role;

ALTER TABLE public.erp_connector_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "erp_conn_tenant_admin_all" ON public.erp_connector_configs
  FOR ALL TO authenticated
  USING (
    public.has_platform_role(auth.uid(), 'platform_admin'::platform_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
  )
  WITH CHECK (
    public.has_platform_role(auth.uid(), 'platform_admin'::platform_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
  );

CREATE POLICY "erp_conn_tenant_member_read" ON public.erp_connector_configs
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));

CREATE OR REPLACE FUNCTION public.set_updated_at_erp_conn() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_erp_conn_updated ON public.erp_connector_configs;
CREATE TRIGGER trg_erp_conn_updated BEFORE UPDATE ON public.erp_connector_configs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_erp_conn();

CREATE TABLE IF NOT EXISTS public.erp_connector_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL REFERENCES public.erp_connector_configs(id) ON DELETE CASCADE,
  connector_kind TEXT NOT NULL,
  triggered_by UUID,
  trigger_kind TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_kind IN ('manual','schedule','api','test')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms INT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','partial','error')),
  rows_fetched INT NOT NULL DEFAULT 0,
  bytes_transferred BIGINT NOT NULL DEFAULT 0,
  request_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  output_ref TEXT
);
CREATE INDEX IF NOT EXISTS idx_erp_runs_connector ON public.erp_connector_runs(connector_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_erp_runs_tenant ON public.erp_connector_runs(tenant_id, started_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.erp_connector_runs TO authenticated;
GRANT ALL ON public.erp_connector_runs TO service_role;

ALTER TABLE public.erp_connector_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "erp_runs_tenant_member_read" ON public.erp_connector_runs
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "erp_runs_tenant_admin_write" ON public.erp_connector_runs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_platform_role(auth.uid(), 'platform_admin'::platform_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
  );
