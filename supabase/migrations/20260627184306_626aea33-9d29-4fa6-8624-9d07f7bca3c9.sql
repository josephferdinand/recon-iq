
REVOKE EXECUTE ON FUNCTION public.user_bu_scope(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_can_access_bu(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_bu_scope(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_can_access_bu(uuid, uuid, uuid) TO authenticated, service_role;
