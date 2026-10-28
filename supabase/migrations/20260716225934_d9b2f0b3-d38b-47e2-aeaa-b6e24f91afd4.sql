
DROP POLICY IF EXISTS was_read ON public.workspace_active_sessions;
CREATE POLICY was_read_owner ON public.workspace_active_sessions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.list_tenant_active_sessions(_tenant_id uuid)
RETURNS TABLE(
  id uuid, user_id uuid, tenant_id uuid, user_agent text, ip text, country text,
  issued_at timestamptz, last_seen_at timestamptz, forced_out_at timestamptz, force_reason text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, user_id, tenant_id, user_agent, ip::text, country,
         issued_at, last_seen_at, forced_out_at, force_reason
  FROM public.workspace_active_sessions
  WHERE tenant_id = _tenant_id AND public.can_admin_tenant(_tenant_id);
$$;
REVOKE ALL ON FUNCTION public.list_tenant_active_sessions(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.list_tenant_active_sessions(uuid) TO authenticated;
