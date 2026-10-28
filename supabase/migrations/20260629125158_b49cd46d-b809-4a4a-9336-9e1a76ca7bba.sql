ALTER TABLE public.ai_usage_events
  ADD COLUMN IF NOT EXISTS tool_calls jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_tenant_created
  ON public.ai_usage_events (tenant_id, created_at DESC);

COMMENT ON COLUMN public.ai_usage_events.tool_calls IS
  'Phase 3 — array of { tool, latency_ms, status } entries appended for every Copilot tool invocation within this LLM turn.';