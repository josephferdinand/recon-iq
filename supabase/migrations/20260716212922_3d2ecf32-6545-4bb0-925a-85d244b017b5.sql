
CREATE TABLE public.ai_provider_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  display_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('managed','byo','self_hosted')),
  auth_methods jsonb NOT NULL DEFAULT '["api_key"]'::jsonb,
  default_endpoint_template text,
  required_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  docs_url text,
  enabled boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_provider_registry TO authenticated;
GRANT ALL ON public.ai_provider_registry TO service_role;
ALTER TABLE public.ai_provider_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aipr_read_auth" ON public.ai_provider_registry FOR SELECT TO authenticated USING (true);
CREATE POLICY "aipr_platform_admin_write" ON public.ai_provider_registry FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE TABLE public.ai_provider_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code text NOT NULL REFERENCES public.ai_provider_registry(code) ON DELETE RESTRICT,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  endpoint text,
  region text,
  auth_method text NOT NULL DEFAULT 'api_key',
  vault_secret_id uuid REFERENCES public.app_vault_secrets(id) ON DELETE SET NULL,
  custom_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  api_version text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','disabled','retired')),
  health_status text NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('unknown','healthy','degraded','down')),
  last_healthcheck_at timestamptz,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_provider_instances TO authenticated;
GRANT ALL ON public.ai_provider_instances TO service_role;
ALTER TABLE public.ai_provider_instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aipi_platform_admin_all" ON public.ai_provider_instances FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE POLICY "aipi_tenant_admin_own" ON public.ai_provider_instances FOR ALL TO authenticated USING (tenant_id IS NOT NULL AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)) WITH CHECK (tenant_id IS NOT NULL AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));
CREATE POLICY "aipi_read_platform_shared" ON public.ai_provider_instances FOR SELECT TO authenticated USING (tenant_id IS NULL);

CREATE TABLE public.ai_model_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_instance_id uuid NOT NULL REFERENCES public.ai_provider_instances(id) ON DELETE CASCADE,
  model_key text NOT NULL,
  display_name text NOT NULL,
  version text,
  context_window int,
  max_input_tokens int,
  max_output_tokens int,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  approval_status text NOT NULL DEFAULT 'proposed' CHECK (approval_status IN ('proposed','approved','retired')),
  availability_status text NOT NULL DEFAULT 'available' CHECK (availability_status IN ('available','limited','deprecated','unavailable')),
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_instance_id, model_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_model_catalog TO authenticated;
GRANT ALL ON public.ai_model_catalog TO service_role;
ALTER TABLE public.ai_model_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aimc_platform_admin_all" ON public.ai_model_catalog FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE POLICY "aimc_read_auth" ON public.ai_model_catalog FOR SELECT TO authenticated USING (true);

CREATE TABLE public.ai_routing_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('platform','tenant')),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  strategy text NOT NULL DEFAULT 'cost' CHECK (strategy IN ('cost','latency','availability','region','compliance','risk','workload','round_robin','manual')),
  chain jsonb NOT NULL DEFAULT '[]'::jsonb,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  priority int NOT NULL DEFAULT 100,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_routing_policies TO authenticated;
GRANT ALL ON public.ai_routing_policies TO service_role;
ALTER TABLE public.ai_routing_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "airp_platform_admin_all" ON public.ai_routing_policies FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE POLICY "airp_tenant_admin_own" ON public.ai_routing_policies FOR ALL TO authenticated USING (scope='tenant' AND tenant_id IS NOT NULL AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)) WITH CHECK (scope='tenant' AND tenant_id IS NOT NULL AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));
CREATE POLICY "airp_read_platform" ON public.ai_routing_policies FOR SELECT TO authenticated USING (scope='platform');

CREATE TABLE public.ai_governance_toggles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('platform','tenant')),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  inherited_from uuid REFERENCES public.ai_governance_toggles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scope, tenant_id, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_governance_toggles TO authenticated;
GRANT ALL ON public.ai_governance_toggles TO service_role;
ALTER TABLE public.ai_governance_toggles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aigt_platform_admin_all" ON public.ai_governance_toggles FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE POLICY "aigt_tenant_admin_own" ON public.ai_governance_toggles FOR ALL TO authenticated USING (scope='tenant' AND tenant_id IS NOT NULL AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)) WITH CHECK (scope='tenant' AND tenant_id IS NOT NULL AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));
CREATE POLICY "aigt_read_platform" ON public.ai_governance_toggles FOR SELECT TO authenticated USING (scope='platform');

CREATE TABLE public.ai_agent_governance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('platform','tenant')),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  autonomy_ceiling text NOT NULL DEFAULT 'suggestion_only' CHECK (autonomy_ceiling IN ('suggestion_only','assisted','semi_autonomous','fully_autonomous')),
  max_runtime_seconds int NOT NULL DEFAULT 300,
  max_actions_per_run int NOT NULL DEFAULT 25,
  max_concurrent_agents int NOT NULL DEFAULT 5,
  approval_threshold_usd numeric(12,2) NOT NULL DEFAULT 10,
  high_risk_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scope, tenant_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_agent_governance TO authenticated;
GRANT ALL ON public.ai_agent_governance TO service_role;
ALTER TABLE public.ai_agent_governance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aiag_platform_admin_all" ON public.ai_agent_governance FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE POLICY "aiag_tenant_admin_own" ON public.ai_agent_governance FOR ALL TO authenticated USING (scope='tenant' AND tenant_id IS NOT NULL AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)) WITH CHECK (scope='tenant' AND tenant_id IS NOT NULL AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));
CREATE POLICY "aiag_read_platform" ON public.ai_agent_governance FOR SELECT TO authenticated USING (scope='platform');

CREATE TABLE public.ai_quotas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  daily_token_limit bigint,
  monthly_token_limit bigint,
  input_token_limit bigint,
  output_token_limit bigint,
  cached_token_limit bigint,
  agent_execution_limit int,
  api_request_limit bigint,
  budget_limit_usd numeric(14,2),
  override_active boolean NOT NULL DEFAULT false,
  override_reason text,
  override_expires_at timestamptz,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_quotas TO authenticated;
GRANT ALL ON public.ai_quotas TO service_role;
ALTER TABLE public.ai_quotas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aiq_platform_admin_all" ON public.ai_quotas FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE POLICY "aiq_tenant_admin_own" ON public.ai_quotas FOR ALL TO authenticated USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)) WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));

CREATE TABLE public.ai_admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before jsonb,
  after jsonb,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.ai_admin_audit TO authenticated;
GRANT ALL ON public.ai_admin_audit TO service_role;
ALTER TABLE public.ai_admin_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aia_platform_admin_read" ON public.ai_admin_audit FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));
CREATE POLICY "aia_tenant_admin_read_own" ON public.ai_admin_audit FOR SELECT TO authenticated USING (tenant_id IS NOT NULL AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));
CREATE POLICY "aia_insert_auth" ON public.ai_admin_audit FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

ALTER TABLE public.app_vault_secrets
  ADD COLUMN IF NOT EXISTS masked_preview text,
  ADD COLUMN IF NOT EXISTS mask_style text NOT NULL DEFAULT 'suffix4',
  ADD COLUMN IF NOT EXISTS never_display_full boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.ai_cp_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['ai_provider_registry','ai_provider_instances','ai_model_catalog','ai_routing_policies','ai_governance_toggles','ai_agent_governance','ai_quotas']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_touch ON public.%1$s', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_touch BEFORE UPDATE ON public.%1$s FOR EACH ROW EXECUTE FUNCTION public.ai_cp_touch_updated_at()', t);
  END LOOP;
END $$;

INSERT INTO public.ai_provider_registry (code, display_name, kind, auth_methods, default_endpoint_template, capabilities, docs_url, sort_order) VALUES
  ('muse',        'Muse',                    'managed',    '["api_key"]'::jsonb,                                    'https://api.meta.ai/v1',                                           '{"chat":true,"embed":true,"image":true,"tools":true,"vision":true}'::jsonb, 'https://platform.muse.com/docs', 10),
  ('azure_muse',  'Azure Muse',              'managed',    '["api_key","managed_identity","oauth"]'::jsonb,         'https://{resource}.muse.azure.com/muse/deployments/{deployment}', '{"chat":true,"embed":true,"tools":true,"vision":true}'::jsonb,             'https://learn.microsoft.com/azure/ai-services/muse/', 20),
  ('anthropic',     'Anthropic Claude',          'managed',    '["api_key"]'::jsonb,                                    'https://api.anthropic.com/v1',                                        '{"chat":true,"tools":true,"vision":true,"reasoning":true}'::jsonb,         'https://docs.anthropic.com', 30),
  ('google_gemini', 'Google Gemini',             'managed',    '["api_key","oauth"]'::jsonb,                            'https://generativelanguage.googleapis.com/v1beta',                    '{"chat":true,"embed":true,"vision":true,"tools":true}'::jsonb,             'https://ai.google.dev/docs', 40),
  ('aws_bedrock',   'AWS Bedrock',               'managed',    '["api_key","managed_identity"]'::jsonb,                 'https://bedrock-runtime.{region}.amazonaws.com',                      '{"chat":true,"embed":true,"tools":true}'::jsonb,                            'https://docs.aws.amazon.com/bedrock/', 50),
  ('cohere',        'Cohere',                    'managed',    '["api_key"]'::jsonb,                                    'https://api.cohere.com/v1',                                           '{"chat":true,"embed":true,"rerank":true}'::jsonb,                          'https://docs.cohere.com', 60),
  ('mistral',       'Mistral',                   'managed',    '["api_key"]'::jsonb,                                    'https://api.mistral.ai/v1',                                           '{"chat":true,"embed":true,"tools":true}'::jsonb,                           'https://docs.mistral.ai', 70),
  ('groq',          'Groq',                      'managed',    '["api_key"]'::jsonb,                                    'https://api.groq.com/muse/v1',                                      '{"chat":true,"tools":true}'::jsonb,                                        'https://console.groq.com/docs', 80),
  ('openrouter',    'OpenRouter',                'managed',    '["api_key"]'::jsonb,                                    'https://openrouter.ai/api/v1',                                        '{"chat":true,"tools":true,"vision":true}'::jsonb,                          'https://openrouter.ai/docs', 90),
  ('ollama',        'Ollama',                    'self_hosted','["api_key","custom_header"]'::jsonb,                    'http://{host}:11434',                                                 '{"chat":true,"embed":true}'::jsonb,                                        'https://ollama.com', 100),
  ('private',       'Private Enterprise Model',  'self_hosted','["api_key","oauth","managed_identity","certificate","custom_header"]'::jsonb, NULL, '{"chat":true,"embed":true,"tools":true}'::jsonb, NULL, 110),
  ('byo',           'Bring Your Own LLM',        'byo',        '["api_key","oauth","managed_identity","certificate","custom_header"]'::jsonb, NULL, '{"chat":true}'::jsonb, NULL, 120)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.ai_governance_toggles (scope, key, value) VALUES
  ('platform','enable_ai_platform','true'::jsonb),
  ('platform','enable_copilot','true'::jsonb),
  ('platform','enable_autonomous_agents','false'::jsonb),
  ('platform','enable_agentic_workflows','false'::jsonb),
  ('platform','enable_recommendations','true'::jsonb),
  ('platform','enable_auto_remediation','false'::jsonb),
  ('platform','enable_external_providers','false'::jsonb),
  ('platform','enable_byo_llm','false'::jsonb),
  ('platform','prompt_logging','"optional"'::jsonb),
  ('platform','pii_detection','"monitor"'::jsonb),
  ('platform','pii_redaction','"recommended"'::jsonb),
  ('platform','sensitive_data_protection','true'::jsonb),
  ('platform','residency_enforcement','true'::jsonb),
  ('platform','human_approval','"high_risk"'::jsonb),
  ('platform','audit_retention_days','365'::jsonb)
ON CONFLICT (scope, tenant_id, key) DO NOTHING;

INSERT INTO public.ai_agent_governance (scope, autonomy_ceiling, max_runtime_seconds, max_actions_per_run, max_concurrent_agents, approval_threshold_usd, high_risk_actions) VALUES
  ('platform','suggestion_only',300,25,5,10,'["financial_transaction","external_send","destructive_delete","policy_override"]'::jsonb)
ON CONFLICT (scope, tenant_id) DO NOTHING;
