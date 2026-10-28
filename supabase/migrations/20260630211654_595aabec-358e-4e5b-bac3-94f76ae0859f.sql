DROP POLICY IF EXISTS runbooks_read ON public.agent_runbooks;
REVOKE SELECT ON public.agent_runbooks FROM anon;
CREATE POLICY runbooks_read ON public.agent_runbooks
  FOR SELECT TO authenticated
  USING (true);