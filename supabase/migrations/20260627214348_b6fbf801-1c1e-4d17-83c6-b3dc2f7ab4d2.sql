ALTER VIEW public.aidp_outputs_live SET (security_invoker = true);
REVOKE EXECUTE ON FUNCTION public.aidp_api_quota_hit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aidp_api_quota_hit(uuid) TO service_role;