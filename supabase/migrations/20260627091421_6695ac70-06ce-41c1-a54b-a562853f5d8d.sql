
REVOKE EXECUTE ON FUNCTION public.user_can_access_recon(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_has_tenant_role_or_group(uuid, uuid, tenant_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_access_recon(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_tenant_role_or_group(uuid, uuid, tenant_role) TO authenticated, service_role;
