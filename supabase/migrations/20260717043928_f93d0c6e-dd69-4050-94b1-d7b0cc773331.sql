
REVOKE EXECUTE ON FUNCTION public.mkt_is_tenant_admin(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mkt_is_workspace_admin(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mkt_is_tenant_member(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mkt_is_workspace_member(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.mkt_is_tenant_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mkt_is_workspace_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mkt_is_tenant_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mkt_is_workspace_member(uuid) TO authenticated, service_role;
