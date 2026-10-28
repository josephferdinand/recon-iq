
REVOKE EXECUTE ON FUNCTION public.seed_default_tenant_groups(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seed_default_platform_groups() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_tenants_seed_groups() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_tenant_groups_touch() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.effective_user_permissions(uuid,uuid,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_has_permission(uuid,uuid,text,uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.seed_default_tenant_groups(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.seed_default_platform_groups() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.effective_user_permissions(uuid,uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_permission(uuid,uuid,text,uuid) TO authenticated, service_role;
