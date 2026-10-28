-- Phase 1.5 — fix rate-limiter column mismatch.
-- Add action_kind to agent_actions and backfill from the canonical tool→kind map.

ALTER TABLE public.agent_actions
  ADD COLUMN IF NOT EXISTS action_kind text;

-- Backfill existing rows from the same TOOL_TO_ACTION_KIND map the app uses.
UPDATE public.agent_actions
SET action_kind = CASE tool
  WHEN 'set_break_lifecycle'         THEN 'resolve_breaks'
  WHEN 'add_break_comment'           THEN 'assign_breaks'
  WHEN 'trigger_reconciliation_run'  THEN 'trigger_reconciliation_run'
  ELSE tool
END
WHERE action_kind IS NULL;

-- Trigger to keep action_kind populated even if a caller forgets to set it.
CREATE OR REPLACE FUNCTION public.agent_actions_set_action_kind()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.action_kind IS NULL THEN
    NEW.action_kind := CASE NEW.tool
      WHEN 'set_break_lifecycle'        THEN 'resolve_breaks'
      WHEN 'add_break_comment'          THEN 'assign_breaks'
      WHEN 'trigger_reconciliation_run' THEN 'trigger_reconciliation_run'
      ELSE NEW.tool
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_actions_set_action_kind ON public.agent_actions;
CREATE TRIGGER trg_agent_actions_set_action_kind
  BEFORE INSERT ON public.agent_actions
  FOR EACH ROW EXECUTE FUNCTION public.agent_actions_set_action_kind();

CREATE INDEX IF NOT EXISTS idx_agent_actions_tenant_kind_created
  ON public.agent_actions (tenant_id, action_kind, created_at DESC);