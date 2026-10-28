
-- 1) Policy versions table
CREATE TABLE IF NOT EXISTS public.agent_action_policy_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  action_key      text NOT NULL,
  revision        integer NOT NULL,
  ceiling         text NOT NULL,
  required_approvers integer NOT NULL,
  reversible      boolean NOT NULL,
  changed_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  change_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, action_key, revision)
);

GRANT SELECT, INSERT ON public.agent_action_policy_versions TO authenticated;
GRANT ALL ON public.agent_action_policy_versions TO service_role;

ALTER TABLE public.agent_action_policy_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read policy versions"
  ON public.agent_action_policy_versions FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));

CREATE POLICY "tenant admins insert policy versions"
  ON public.agent_action_policy_versions FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));

CREATE INDEX IF NOT EXISTS idx_aapv_tenant_action
  ON public.agent_action_policy_versions (tenant_id, action_key, revision DESC);

-- 2) Snapshot trigger on agent_action_policies (tenant overrides only)
CREATE OR REPLACE FUNCTION public.tg_snapshot_agent_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_next int;
BEGIN
  IF NEW.tenant_id IS NULL THEN RETURN NEW; END IF; -- skip platform defaults
  SELECT COALESCE(MAX(revision), 0) + 1 INTO v_next
    FROM public.agent_action_policy_versions
   WHERE tenant_id = NEW.tenant_id AND action_key = NEW.action_key;
  INSERT INTO public.agent_action_policy_versions
    (tenant_id, action_key, revision, ceiling, required_approvers, reversible, changed_by, change_reason)
  VALUES
    (NEW.tenant_id, NEW.action_key, v_next, NEW.ceiling::text, NEW.required_approvers, NEW.reversible,
     COALESCE(NEW.updated_by, auth.uid()), NULL);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_snapshot_agent_policy_aiu ON public.agent_action_policies;
CREATE TRIGGER tg_snapshot_agent_policy_aiu
AFTER INSERT OR UPDATE ON public.agent_action_policies
FOR EACH ROW EXECUTE FUNCTION public.tg_snapshot_agent_policy();

-- 3) Realtime on agent_actions
ALTER TABLE public.agent_actions REPLICA IDENTITY FULL;
DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_actions;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
