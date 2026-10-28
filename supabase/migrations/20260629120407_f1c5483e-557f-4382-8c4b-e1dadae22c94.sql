
-- 1) Self-approval guard (Fable item #1) — implemented as a trigger because the
--    requester (agent_runs.user_id) lives in a different table than the approver
--    (agent_actions.approved_by), and CHECK constraints cannot reference other tables.
CREATE OR REPLACE FUNCTION public.agent_actions_no_self_approve()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requester_id uuid;
BEGIN
  IF NEW.approved_by IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.approved_by IS NOT DISTINCT FROM NEW.approved_by THEN
    RETURN NEW;
  END IF;
  SELECT user_id INTO requester_id FROM public.agent_runs WHERE id = NEW.run_id;
  IF requester_id IS NOT NULL AND requester_id = NEW.approved_by THEN
    RAISE EXCEPTION 'agent.self_approve_blocked'
      USING HINT = 'Approver must differ from the user who started the agent run.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.agent_actions_no_self_approve() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_agent_actions_no_self_approve ON public.agent_actions;
CREATE TRIGGER trg_agent_actions_no_self_approve
BEFORE INSERT OR UPDATE OF approved_by, status ON public.agent_actions
FOR EACH ROW EXECUTE FUNCTION public.agent_actions_no_self_approve();

-- 2) Per-(tenant, agent_key, action_kind) hourly rate-limit config (Fable item #4).
CREATE TABLE IF NOT EXISTS public.agent_action_hourly_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  agent_key text NOT NULL DEFAULT 'default',
  action_kind text NOT NULL,
  limit_per_hour integer NOT NULL CHECK (limit_per_hour >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_hourly_limits
  ON public.agent_action_hourly_limits (
    COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    agent_key,
    action_kind
  );

GRANT SELECT ON public.agent_action_hourly_limits TO authenticated;
GRANT ALL ON public.agent_action_hourly_limits TO service_role;

ALTER TABLE public.agent_action_hourly_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_hourly_limits_read ON public.agent_action_hourly_limits;
CREATE POLICY agent_hourly_limits_read ON public.agent_action_hourly_limits
  FOR SELECT TO authenticated
  USING (
    tenant_id IS NULL
    OR private.is_tenant_member(auth.uid(), tenant_id)
    OR private.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS agent_hourly_limits_write ON public.agent_action_hourly_limits;
CREATE POLICY agent_hourly_limits_write ON public.agent_action_hourly_limits
  FOR ALL TO authenticated
  USING (
    (tenant_id IS NOT NULL AND private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
    OR private.is_platform_admin(auth.uid())
  )
  WITH CHECK (
    (tenant_id IS NOT NULL AND private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
    OR private.is_platform_admin(auth.uid())
  );

-- Seed defaults (tenant_id NULL = global default, used when no tenant override exists).
INSERT INTO public.agent_action_hourly_limits (tenant_id, agent_key, action_kind, limit_per_hour)
VALUES
  (NULL, 'default', 'resolve_breaks', 30),
  (NULL, 'default', 'assign_breaks', 60),
  (NULL, 'default', 'trigger_reconciliation_run', 10)
ON CONFLICT DO NOTHING;
