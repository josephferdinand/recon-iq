
-- Fix 1: tenant_custom_domains anon overexposure
DROP POLICY IF EXISTS "custom_domains anon read verified" ON public.tenant_custom_domains;
REVOKE SELECT ON public.tenant_custom_domains FROM anon;

-- Minimal public view for verified domain lookups (host + verified flag only)
CREATE OR REPLACE VIEW public.tenant_custom_domains_public
WITH (security_invoker = true) AS
SELECT
  host,
  (verification_status = 'verified') AS is_verified
FROM public.tenant_custom_domains
WHERE verification_status = 'verified';

-- Allow anon+authenticated to read the safe view; enforce via a permissive policy on the base table scoped to the safe columns via view semantics.
GRANT SELECT ON public.tenant_custom_domains_public TO anon, authenticated;

-- The view uses security_invoker; grant a narrow SELECT policy on the base table so the view resolves for anon.
CREATE POLICY "custom_domains anon read verified minimal" ON public.tenant_custom_domains
  FOR SELECT
  TO anon
  USING (verification_status = 'verified');
-- Column-level restriction: revoke full column SELECT from anon and grant only host + verification_status.
REVOKE SELECT ON public.tenant_custom_domains FROM anon;
GRANT SELECT (host, verification_status) ON public.tenant_custom_domains TO anon;

-- Fix 2: mkt_kb_chunks - split ALL policy so DELETE requires super_admin/ai_admin
DROP POLICY IF EXISTS mkt_kb_chunks_admin ON public.mkt_kb_chunks;

CREATE POLICY mkt_kb_chunks_select ON public.mkt_kb_chunks
  FOR SELECT
  TO authenticated
  USING (has_any_mkt_role(auth.uid()));

CREATE POLICY mkt_kb_chunks_insert ON public.mkt_kb_chunks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    has_mkt_role(auth.uid(), 'super_admin'::mkt_admin_role)
    OR has_mkt_role(auth.uid(), 'ai_admin'::mkt_admin_role)
  );

CREATE POLICY mkt_kb_chunks_update ON public.mkt_kb_chunks
  FOR UPDATE
  TO authenticated
  USING (
    has_mkt_role(auth.uid(), 'super_admin'::mkt_admin_role)
    OR has_mkt_role(auth.uid(), 'ai_admin'::mkt_admin_role)
  )
  WITH CHECK (
    has_mkt_role(auth.uid(), 'super_admin'::mkt_admin_role)
    OR has_mkt_role(auth.uid(), 'ai_admin'::mkt_admin_role)
  );

CREATE POLICY mkt_kb_chunks_delete ON public.mkt_kb_chunks
  FOR DELETE
  TO authenticated
  USING (
    has_mkt_role(auth.uid(), 'super_admin'::mkt_admin_role)
    OR has_mkt_role(auth.uid(), 'ai_admin'::mkt_admin_role)
  );
