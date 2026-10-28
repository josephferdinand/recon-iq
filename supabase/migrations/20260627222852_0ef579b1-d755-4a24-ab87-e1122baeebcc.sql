-- Tighten DB-level RBAC to mirror server-side approver/admin enforcement
-- agent_actions: analysts may CREATE proposed actions, but only tenant_admin
-- (approvers) may UPDATE/DELETE (approve, reject, revert, bulk ops).

DROP POLICY IF EXISTS agent_act_write ON public.agent_actions;

CREATE POLICY agent_act_insert ON public.agent_actions
  FOR INSERT TO authenticated
  WITH CHECK (
    private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
    OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR private.is_platform_admin(auth.uid())
  );

CREATE POLICY agent_act_update ON public.agent_actions
  FOR UPDATE TO authenticated
  USING (
    private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR private.is_platform_admin(auth.uid())
  )
  WITH CHECK (
    private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR private.is_platform_admin(auth.uid())
  );

CREATE POLICY agent_act_delete ON public.agent_actions
  FOR DELETE TO authenticated
  USING (
    private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR private.is_platform_admin(auth.uid())
  );

-- agent_action_policy_versions: lock out non-admin direct INSERTs
-- (the SECURITY DEFINER snapshot trigger bypasses RLS), and forbid
-- UPDATE/DELETE so the version history stays append-only.
DROP POLICY IF EXISTS "tenant admins insert policy versions" ON public.agent_action_policy_versions;

CREATE POLICY policy_versions_admin_insert ON public.agent_action_policy_versions
  FOR INSERT TO authenticated
  WITH CHECK (
    private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR private.is_platform_admin(auth.uid())
  );

CREATE POLICY policy_versions_no_update ON public.agent_action_policy_versions
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY policy_versions_no_delete ON public.agent_action_policy_versions
  FOR DELETE TO authenticated USING (false);