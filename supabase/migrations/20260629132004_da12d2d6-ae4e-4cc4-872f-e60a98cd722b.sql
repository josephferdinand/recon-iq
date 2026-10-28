CREATE TABLE public.copilot_plugin_tool_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  thread_id uuid,
  plugin_id text NOT NULL,
  tool_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok','error')),
  latency_ms integer,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.copilot_plugin_tool_audit TO authenticated;
GRANT ALL ON public.copilot_plugin_tool_audit TO service_role;

ALTER TABLE public.copilot_plugin_tool_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read plugin tool audit"
  ON public.copilot_plugin_tool_audit FOR SELECT TO authenticated
  USING (is_tenant_member(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()));

CREATE POLICY "tenant members insert plugin tool audit"
  ON public.copilot_plugin_tool_audit FOR INSERT TO authenticated
  WITH CHECK (is_tenant_member(auth.uid(), tenant_id) AND actor_user_id = auth.uid());

CREATE INDEX idx_cpta_tenant_time ON public.copilot_plugin_tool_audit (tenant_id, created_at DESC);
CREATE INDEX idx_cpta_plugin_time ON public.copilot_plugin_tool_audit (plugin_id, created_at DESC);
CREATE INDEX idx_cpta_actor_time ON public.copilot_plugin_tool_audit (actor_user_id, created_at DESC);