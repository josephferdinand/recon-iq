
-- 1. Fix mutable search_path on jsonb_deep_merge
ALTER FUNCTION public.jsonb_deep_merge(jsonb, jsonb) SET search_path = public, pg_temp;

-- 2. Remove anon SELECT on platform_auth_providers; expose only enabled rows via RPC
DROP POLICY IF EXISTS auth_providers_read_all ON public.platform_auth_providers;
REVOKE SELECT ON public.platform_auth_providers FROM anon;

-- Authenticated users (esp. admins) can still read the table directly
CREATE POLICY auth_providers_read_authenticated
  ON public.platform_auth_providers
  FOR SELECT
  TO authenticated
  USING (true);

-- Public-safe view of enabled providers only, via SECURITY DEFINER RPC
CREATE OR REPLACE FUNCTION public.list_public_auth_providers()
RETURNS TABLE(provider text, label text, description text, enabled boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT provider, label, description, enabled
  FROM public.platform_auth_providers
  WHERE enabled = true
  ORDER BY provider;
$$;
REVOKE ALL ON FUNCTION public.list_public_auth_providers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_public_auth_providers() TO anon, authenticated;

-- 3. Restrict platform-shared AI provider rows to platform admins
DROP POLICY IF EXISTS aipi_read_platform_shared ON public.ai_provider_instances;
CREATE POLICY aipi_read_platform_shared
  ON public.ai_provider_instances
  FOR SELECT
  TO authenticated
  USING (tenant_id IS NULL AND is_platform_admin(auth.uid()));

-- 4. Re-scope overly-broad {public} policies on financial tables to authenticated
-- master_accounts
DROP POLICY IF EXISTS ma_write ON public.master_accounts;
CREATE POLICY ma_write ON public.master_accounts
  FOR ALL TO authenticated
  USING (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role))
  WITH CHECK (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role));

-- dq_rules
DROP POLICY IF EXISTS dq_rules_select ON public.dq_rules;
CREATE POLICY dq_rules_select ON public.dq_rules
  FOR SELECT TO authenticated
  USING (is_tenant_member(auth.uid(), tenant_id));
DROP POLICY IF EXISTS dq_rules_write ON public.dq_rules;
CREATE POLICY dq_rules_write ON public.dq_rules
  FOR ALL TO authenticated
  USING (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role))
  WITH CHECK (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role));

-- sec_lending_loans
DROP POLICY IF EXISTS sll_select ON public.sec_lending_loans;
CREATE POLICY sll_select ON public.sec_lending_loans
  FOR SELECT TO authenticated
  USING (is_tenant_member(auth.uid(), tenant_id));
DROP POLICY IF EXISTS sll_write ON public.sec_lending_loans;
CREATE POLICY sll_write ON public.sec_lending_loans
  FOR ALL TO authenticated
  USING (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role))
  WITH CHECK (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role));

-- loan_facilities
DROP POLICY IF EXISTS lf_select ON public.loan_facilities;
CREATE POLICY lf_select ON public.loan_facilities
  FOR SELECT TO authenticated
  USING (is_tenant_member(auth.uid(), tenant_id));
DROP POLICY IF EXISTS lf_write ON public.loan_facilities;
CREATE POLICY lf_write ON public.loan_facilities
  FOR ALL TO authenticated
  USING (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role))
  WITH CHECK (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role));

-- fund_nav_runs
DROP POLICY IF EXISTS nav_tenant_select ON public.fund_nav_runs;
CREATE POLICY nav_tenant_select ON public.fund_nav_runs
  FOR SELECT TO authenticated
  USING (is_tenant_member(auth.uid(), tenant_id));
DROP POLICY IF EXISTS nav_tenant_write ON public.fund_nav_runs;
CREATE POLICY nav_tenant_write ON public.fund_nav_runs
  FOR ALL TO authenticated
  USING (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role))
  WITH CHECK (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role));

-- collateral_pledges
DROP POLICY IF EXISTS cp_select ON public.collateral_pledges;
CREATE POLICY cp_select ON public.collateral_pledges
  FOR SELECT TO authenticated
  USING (is_tenant_member(auth.uid(), tenant_id));
DROP POLICY IF EXISTS cp_write ON public.collateral_pledges;
CREATE POLICY cp_write ON public.collateral_pledges
  FOR ALL TO authenticated
  USING (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role))
  WITH CHECK (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role));
