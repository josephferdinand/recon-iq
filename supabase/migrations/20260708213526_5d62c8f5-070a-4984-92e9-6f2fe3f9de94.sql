
-- Extend tenant_sso_configs with metadata XML + signing certificate rotation
ALTER TABLE public.tenant_sso_configs
  ADD COLUMN IF NOT EXISTS metadata_xml text,
  ADD COLUMN IF NOT EXISTS metadata_source text CHECK (metadata_source IN ('url','xml')) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS metadata_fetched_at timestamptz,
  ADD COLUMN IF NOT EXISTS signing_cert text,
  ADD COLUMN IF NOT EXISTS signing_cert_fingerprint text,
  ADD COLUMN IF NOT EXISTS signing_cert_not_before timestamptz,
  ADD COLUMN IF NOT EXISTS signing_cert_not_after timestamptz,
  ADD COLUMN IF NOT EXISTS previous_signing_cert text,
  ADD COLUMN IF NOT EXISTS previous_signing_cert_fingerprint text,
  ADD COLUMN IF NOT EXISTS cert_rotated_at timestamptz,
  ADD COLUMN IF NOT EXISTS cert_rotated_by uuid REFERENCES auth.users(id);

-- Cert rotation audit history — one row per rotation event.
CREATE TABLE IF NOT EXISTS public.tenant_sso_cert_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sso_config_id uuid NOT NULL REFERENCES public.tenant_sso_configs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cert text NOT NULL,
  fingerprint text NOT NULL,
  not_before timestamptz,
  not_after timestamptz,
  rotated_at timestamptz NOT NULL DEFAULT now(),
  rotated_by uuid REFERENCES auth.users(id),
  source text NOT NULL CHECK (source IN ('metadata_url','metadata_xml','manual_paste')),
  note text
);

GRANT SELECT, INSERT ON public.tenant_sso_cert_history TO authenticated;
GRANT ALL ON public.tenant_sso_cert_history TO service_role;

ALTER TABLE public.tenant_sso_cert_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sso_cert_history_read" ON public.tenant_sso_cert_history
  FOR SELECT TO authenticated
  USING (
    private.is_tenant_member(auth.uid(), tenant_id)
    OR private.is_platform_admin(auth.uid())
  );

CREATE POLICY "sso_cert_history_insert" ON public.tenant_sso_cert_history
  FOR INSERT TO authenticated
  WITH CHECK (
    private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR private.is_platform_admin(auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_sso_cert_history_config ON public.tenant_sso_cert_history(sso_config_id, rotated_at DESC);
