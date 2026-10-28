
-- Phase 2 — needsApproval confirmation tokens + write-tool action_kind mapping.
-- 1. Confirmation token columns on agent_actions (single-use, 5-minute TTL).
ALTER TABLE public.agent_actions
  ADD COLUMN IF NOT EXISTS confirmation_token TEXT,
  ADD COLUMN IF NOT EXISTS confirmation_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_actions_confirmation_token
  ON public.agent_actions(confirmation_token)
  WHERE confirmation_token IS NOT NULL;

-- 2. Backfill TOOL_TO_ACTION_KIND for new write tools at the DB-trigger level
-- so any direct insert that omits action_kind still gets bucketed correctly.
CREATE OR REPLACE FUNCTION public.agent_actions_backfill_action_kind()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.action_kind IS NULL THEN
    NEW.action_kind := CASE NEW.tool
      WHEN 'set_break_lifecycle' THEN 'resolve_breaks'
      WHEN 'add_break_comment'   THEN 'assign_breaks'
      WHEN 'assign_breaks'       THEN 'assign_breaks'
      WHEN 'resolve_breaks'      THEN 'resolve_breaks'
      WHEN 'trigger_reconciliation_run' THEN 'trigger_reconciliation_run'
      ELSE NEW.tool
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
