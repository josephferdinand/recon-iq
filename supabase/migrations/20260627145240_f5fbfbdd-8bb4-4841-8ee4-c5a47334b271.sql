
-- 1. Audit anchors (external R2 anchor records of audit chain)
CREATE TABLE IF NOT EXISTS public.audit_anchors (
  id BIGSERIAL PRIMARY KEY,
  anchored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_audit_id BIGINT NOT NULL,
  row_hash_hex TEXT NOT NULL,
  external_uri TEXT,
  external_object_lock_until TIMESTAMPTZ,
  notes TEXT
);
GRANT SELECT ON public.audit_anchors TO authenticated;
GRANT ALL ON public.audit_anchors TO service_role;
ALTER TABLE public.audit_anchors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_anchors readable by platform admins"
  ON public.audit_anchors FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- 2. Stripe events idempotency
CREATE TABLE IF NOT EXISTS public.stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  livemode BOOLEAN NOT NULL DEFAULT false,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  payload JSONB
);
GRANT SELECT ON public.stripe_events TO authenticated;
GRANT ALL ON public.stripe_events TO service_role;
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stripe_events readable by platform admins"
  ON public.stripe_events FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- 3. Agent autonomy policies (per-action ceilings & approver counts)
CREATE TABLE IF NOT EXISTS public.agent_action_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  action_key TEXT NOT NULL,
  ceiling TEXT NOT NULL DEFAULT 'suggest' CHECK (ceiling IN ('suggest','assist','auto')),
  required_approvers INT NOT NULL DEFAULT 0,
  reversible BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  UNIQUE(tenant_id, action_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_action_policies TO authenticated;
GRANT ALL ON public.agent_action_policies TO service_role;
ALTER TABLE public.agent_action_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_action_policies tenant read"
  ON public.agent_action_policies FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "agent_action_policies tenant admin write"
  ON public.agent_action_policies FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));

-- 4. Sub-processor register (per-tenant, plus global defaults)
CREATE TABLE IF NOT EXISTS public.sub_processors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  data_categories TEXT[] DEFAULT '{}',
  region TEXT,
  website TEXT,
  dpa_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sub_processors TO authenticated;
GRANT ALL ON public.sub_processors TO service_role;
ALTER TABLE public.sub_processors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sub_processors read"
  ON public.sub_processors FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "sub_processors write"
  ON public.sub_processors FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));

-- 5. Retention policy catalog
CREATE TABLE IF NOT EXISTS public.retention_policies (
  table_name TEXT PRIMARY KEY,
  retention_days INT NOT NULL,
  regulatory_basis TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.retention_policies TO authenticated;
GRANT ALL ON public.retention_policies TO service_role;
ALTER TABLE public.retention_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "retention_policies readable by all members"
  ON public.retention_policies FOR SELECT TO authenticated USING (true);

INSERT INTO public.retention_policies(table_name, retention_days, regulatory_basis) VALUES
  ('audit_log', 2557, 'SOX / SOC2 / 7-year regulatory minimum'),
  ('ai_usage_events', 730, 'AI governance audit trail (2 years)'),
  ('security_events', 730, 'SOC2 CC7.2 incident detection (2 years)'),
  ('recon_runs', 395, 'Tenant default 13 months; overridable per tenant'),
  ('email_send_log', 365, 'CAN-SPAM / deliverability investigation window')
ON CONFLICT (table_name) DO NOTHING;

-- 6. byok_keys rotation fields
ALTER TABLE public.byok_keys
  ADD COLUMN IF NOT EXISTS key_version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_rotated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rotation_policy_days INT NOT NULL DEFAULT 90;

-- 7. api_tokens lifecycle fields
ALTER TABLE public.api_tokens
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- 8. llm_providers per-provider allowed regions (residency enforcement)
ALTER TABLE public.llm_providers
  ADD COLUMN IF NOT EXISTS allowed_regions TEXT[] NOT NULL DEFAULT '{}';

-- 9. Step-up auth re-auth record
CREATE TABLE IF NOT EXISTS public.step_up_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  action_key TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes'),
  consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_step_up_grants_lookup
  ON public.step_up_grants(user_id, action_key, expires_at);
GRANT SELECT, INSERT, UPDATE ON public.step_up_grants TO authenticated;
GRANT ALL ON public.step_up_grants TO service_role;
ALTER TABLE public.step_up_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "step_up_grants owner only"
  ON public.step_up_grants FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
