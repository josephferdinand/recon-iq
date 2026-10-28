
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS agent_max_actions INTEGER NOT NULL DEFAULT 50
    CHECK (agent_max_actions BETWEEN 1 AND 500),
  ADD COLUMN IF NOT EXISTS agent_max_distinct_tables INTEGER NOT NULL DEFAULT 10
    CHECK (agent_max_distinct_tables BETWEEN 1 AND 50);

ALTER TABLE public.agent_actions
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

CREATE INDEX IF NOT EXISTS agent_actions_review_queue_idx
  ON public.agent_actions (tenant_id, proposed, status, created_at DESC);
