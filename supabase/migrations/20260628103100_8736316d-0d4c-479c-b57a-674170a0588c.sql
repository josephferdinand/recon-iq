
-- =========================================================================
-- 1) Multi-agent workflows
-- =========================================================================
CREATE TABLE public.agent_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  graph jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  enabled boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_workflows TO authenticated;
GRANT ALL ON public.agent_workflows TO service_role;
ALTER TABLE public.agent_workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wf_read" ON public.agent_workflows FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "wf_write_admin" ON public.agent_workflows FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));
CREATE TRIGGER trg_agent_workflows_updated BEFORE UPDATE ON public.agent_workflows
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.agent_workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.agent_workflows(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed','cancelled')),
  trace jsonb NOT NULL DEFAULT '[]'::jsonb,
  triggered_by uuid REFERENCES auth.users(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
GRANT SELECT, INSERT, UPDATE ON public.agent_workflow_runs TO authenticated;
GRANT ALL ON public.agent_workflow_runs TO service_role;
ALTER TABLE public.agent_workflow_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wfr_read" ON public.agent_workflow_runs FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "wfr_insert_admin" ON public.agent_workflow_runs FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));

-- =========================================================================
-- 2) Webhooks / Plugin SDK
-- =========================================================================
CREATE TABLE public.webhook_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  secret_hash text NOT NULL,
  events text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhook_subscriptions TO authenticated;
GRANT ALL ON public.webhook_subscriptions TO service_role;
ALTER TABLE public.webhook_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wh_read" ON public.webhook_subscriptions FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "wh_write_admin" ON public.webhook_subscriptions FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));
CREATE TRIGGER trg_webhook_subs_updated BEFORE UPDATE ON public.webhook_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.webhook_subscriptions(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event text NOT NULL,
  payload jsonb NOT NULL,
  response_status int,
  response_body text,
  attempt int NOT NULL DEFAULT 1,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.webhook_deliveries TO authenticated;
GRANT ALL ON public.webhook_deliveries TO service_role;
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "whd_read" ON public.webhook_deliveries FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE INDEX idx_whd_sub_created ON public.webhook_deliveries(subscription_id, created_at DESC);

-- =========================================================================
-- 3) Process Library (publishable reusable recon processes)
-- =========================================================================
CREATE TABLE public.process_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  summary text,
  category text NOT NULL,
  asset_class text,
  blueprint jsonb NOT NULL DEFAULT '{}'::jsonb,
  published boolean NOT NULL DEFAULT false,
  version int NOT NULL DEFAULT 1,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.process_library TO authenticated;
GRANT ALL ON public.process_library TO service_role;
ALTER TABLE public.process_library ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pl_read_published" ON public.process_library FOR SELECT TO authenticated
  USING (published = true OR public.is_platform_admin(auth.uid()));
CREATE POLICY "pl_admin_write" ON public.process_library FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_process_library_updated BEFORE UPDATE ON public.process_library
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========================================================================
-- 4) CMEK / BYOK key registry (references only, no key material)
-- =========================================================================
CREATE TABLE public.cmek_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('aws_kms','gcp_kms','azure_kv','hashicorp_vault')),
  key_uri text NOT NULL,
  alias text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','rotating','disabled')),
  last_rotated_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key_uri)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cmek_keys TO authenticated;
GRANT ALL ON public.cmek_keys TO service_role;
ALTER TABLE public.cmek_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cmek_read" ON public.cmek_keys FOR SELECT TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
         OR public.is_platform_admin(auth.uid()));
CREATE POLICY "cmek_admin_write" ON public.cmek_keys FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));
CREATE TRIGGER trg_cmek_keys_updated BEFORE UPDATE ON public.cmek_keys
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
