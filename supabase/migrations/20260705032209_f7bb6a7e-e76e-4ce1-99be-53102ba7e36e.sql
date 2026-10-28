
CREATE TABLE public.erp_connector_test_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL REFERENCES public.erp_connector_configs(id) ON DELETE CASCADE,
  credential_secret_id UUID NULL,
  credential_version INT NULL,
  credential_fingerprint TEXT NULL,
  ok BOOLEAN NOT NULL,
  http_status INT NULL,
  latency_ms INT NULL,
  probe_kind TEXT NOT NULL DEFAULT 'HEAD',
  base_url TEXT NULL,
  error_kind TEXT NULL,
  error_message TEXT NULL,
  error_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  triggered_by UUID NULL,
  trigger_source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX erp_test_history_connector_idx
  ON public.erp_connector_test_history (connector_id, created_at DESC);
CREATE INDEX erp_test_history_tenant_idx
  ON public.erp_connector_test_history (tenant_id, created_at DESC);
CREATE INDEX erp_test_history_credential_version_idx
  ON public.erp_connector_test_history (credential_secret_id, credential_version, created_at DESC);

GRANT SELECT, INSERT ON public.erp_connector_test_history TO authenticated;
GRANT ALL ON public.erp_connector_test_history TO service_role;

ALTER TABLE public.erp_connector_test_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "erp_test_history_select_tenant_members"
  ON public.erp_connector_test_history FOR SELECT TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst')
    OR public.has_platform_role(auth.uid(), 'platform_admin')
  );

CREATE POLICY "erp_test_history_insert_admins"
  ON public.erp_connector_test_history FOR INSERT TO authenticated
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
    OR public.has_platform_role(auth.uid(), 'platform_admin')
  );
