DROP POLICY IF EXISTS aigov_log_insert ON public.ai_governance_prompt_log;
CREATE POLICY aigov_log_insert ON public.ai_governance_prompt_log
  FOR INSERT TO authenticated
  WITH CHECK (
    is_tenant_member(auth.uid(), tenant_id)
    AND (user_id IS NULL OR user_id = auth.uid())
  );