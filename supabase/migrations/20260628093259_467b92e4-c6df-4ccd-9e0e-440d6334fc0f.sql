
REVOKE EXECUTE ON FUNCTION public.find_invitation_by_token(text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.find_invitation_by_token(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.tenant_user_analytics(uuid, int) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.tenant_user_analytics(uuid, int) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.platform_user_analytics(int) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.platform_user_analytics(int) TO authenticated;
