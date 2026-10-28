
DROP POLICY IF EXISTS auth_providers_read_all ON public.platform_auth_providers;
CREATE POLICY auth_providers_read_auth ON public.platform_auth_providers
  FOR SELECT
  TO authenticated
  USING (true);
REVOKE SELECT ON public.platform_auth_providers FROM anon;
