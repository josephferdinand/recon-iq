
-- PR1: seed default global policies (tenant_id NULL = platform default)
INSERT INTO public.agent_action_policies (tenant_id, action_key, ceiling, required_approvers, reversible)
VALUES
  (NULL, 'search_breaks',       'auto',    0, true),
  (NULL, 'inspect_break',       'auto',    0, true),
  (NULL, 'report_overview',     'auto',    0, true),
  (NULL, 'add_break_comment',   'assist',  0, true),
  (NULL, 'set_break_lifecycle', 'assist',  1, true),
  (NULL, 'rule.modify',         'suggest', 2, true),
  (NULL, 'rule.publish',        'suggest', 2, false),
  (NULL, 'match.approve',       'assist',  1, true),
  (NULL, 'match.reject',        'assist',  1, true),
  (NULL, 'data_source.disable', 'suggest', 1, true)
ON CONFLICT (tenant_id, action_key) DO NOTHING;

-- PR3: agent_runs additions
ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'execute'
    CHECK (mode IN ('plan','execute')),
  ADD COLUMN IF NOT EXISTS scope_limits JSONB NOT NULL DEFAULT
    '{"max_actions":50,"max_distinct_tables":10}'::jsonb,
  ADD COLUMN IF NOT EXISTS executed_actions_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS planned_actions_count  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS distinct_tables_touched TEXT[] NOT NULL DEFAULT '{}';

-- PR4: agent_actions additions (reversal + policy snapshot + plan/proposed)
ALTER TABLE public.agent_actions
  ADD COLUMN IF NOT EXISTS proposed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS policy_ceiling TEXT,
  ADD COLUMN IF NOT EXISTS reversal_token TEXT,
  ADD COLUMN IF NOT EXISTS before_state JSONB,
  ADD COLUMN IF NOT EXISTS reverted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reverted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS agent_actions_reversal_token_uidx
  ON public.agent_actions (reversal_token) WHERE reversal_token IS NOT NULL;

-- PR3: per-tenant per-minute write-action rate limit
CREATE TABLE IF NOT EXISTS public.agent_action_rate_limits (
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bucket_minute TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, bucket_minute)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_action_rate_limits TO authenticated;
GRANT ALL ON public.agent_action_rate_limits TO service_role;
ALTER TABLE public.agent_action_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_rl_member_read" ON public.agent_action_rate_limits
  FOR SELECT TO authenticated
  USING (private.is_tenant_member(auth.uid(), tenant_id) OR private.is_platform_admin(auth.uid()));
CREATE POLICY "agent_rl_member_write" ON public.agent_action_rate_limits
  FOR ALL TO authenticated
  USING (private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role) OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR private.is_platform_admin(auth.uid()))
  WITH CHECK (private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role) OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR private.is_platform_admin(auth.uid()));

-- PR2: model → allowed regions map for residency enforcement
CREATE TABLE IF NOT EXISTS public.llm_model_regions (
  model TEXT PRIMARY KEY,
  allowed_regions TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.llm_model_regions TO authenticated;
GRANT ALL ON public.llm_model_regions TO service_role;
ALTER TABLE public.llm_model_regions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "llm_model_regions read" ON public.llm_model_regions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "llm_model_regions admin write" ON public.llm_model_regions
  FOR ALL TO authenticated
  USING (private.is_platform_admin(auth.uid()))
  WITH CHECK (private.is_platform_admin(auth.uid()));

INSERT INTO public.llm_model_regions (model, allowed_regions, notes) VALUES
  ('google/gemini-3-flash-preview', ARRAY['us-east-1','us-west-2','eu-west-1','eu-central-1','global'], 'Gemini 3 Flash via Meta Gateway — multi-region.'),
  ('google/gemini-2.5-pro',         ARRAY['us-east-1','us-west-2','eu-west-1','global'], 'Gemini 2.5 Pro — EU + US.'),
  ('google/gemini-2.5-flash',       ARRAY['us-east-1','us-west-2','eu-west-1','global'], 'Gemini 2.5 Flash — EU + US.'),
  ('muse/gpt-5',                  ARRAY['us-east-1','us-west-2','global'], 'Muse GPT-5 — US-only routing.'),
  ('muse/gpt-5-mini',             ARRAY['us-east-1','us-west-2','global'], 'Muse GPT-5 mini — US-only.')
ON CONFLICT (model) DO UPDATE SET allowed_regions = EXCLUDED.allowed_regions, notes = EXCLUDED.notes, updated_at = now();
