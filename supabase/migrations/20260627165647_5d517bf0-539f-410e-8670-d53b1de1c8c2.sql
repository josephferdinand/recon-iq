
-- 1) chat_ops_subscriptions: restrict SELECT to admins (webhook_url may carry secrets)
DROP POLICY IF EXISTS "chat read" ON public.chat_ops_subscriptions;
CREATE POLICY "chat read admins" ON public.chat_ops_subscriptions
  FOR SELECT TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.is_platform_admin(auth.uid())
  );

-- 2) llm_providers: drop the over-broad member SELECT policy; expose a safe view for members
DROP POLICY IF EXISTS "tenant members read tenant llm (non-key cols)" ON public.llm_providers;

CREATE OR REPLACE VIEW public.llm_providers_safe
WITH (security_invoker = true) AS
SELECT id, scope, tenant_id, provider, display_name, base_url, model,
       key_last4, is_active, allowed_regions, created_at, updated_at
FROM public.llm_providers;

-- View needs a permissive SELECT policy on the base table for members; add one
-- that excludes key columns by virtue of the view's projection.
CREATE POLICY "tenant members read tenant llm via view" ON public.llm_providers
  FOR SELECT TO authenticated
  USING (
    scope = 'tenant'::llm_scope
    AND public.is_tenant_member(auth.uid(), tenant_id)
  );
-- Revoke direct column access to secret-reference columns from regular users
REVOKE SELECT (key_secret_name, key_fingerprint) ON public.llm_providers FROM authenticated;
GRANT SELECT ON public.llm_providers_safe TO authenticated;
GRANT ALL ON public.llm_providers_safe TO service_role;

-- 3) tenant_invitations: stop returning the raw token to invitees via RLS.
-- Acceptance flows look up the invitation by token through server functions
-- (service role / security-definer paths), not via authenticated SELECT.
DROP POLICY IF EXISTS "invitee can see own invitations (no token)" ON public.tenant_invitations;

CREATE OR REPLACE VIEW public.tenant_invitations_for_invitee
WITH (security_invoker = true) AS
SELECT id, tenant_id, email, role, invited_by, expires_at, created_at
FROM public.tenant_invitations
WHERE (auth.jwt() ->> 'email') IS NOT NULL
  AND lower(email::text) = lower(auth.jwt() ->> 'email')
  AND accepted_at IS NULL
  AND expires_at > now();

-- Allow invitees to see their pending invitations through the safe view (no token column)
CREATE POLICY "invitee can see own invitations via view" ON public.tenant_invitations
  FOR SELECT TO authenticated
  USING (
    (auth.jwt() ->> 'email') IS NOT NULL
    AND lower(email::text) = lower(auth.jwt() ->> 'email')
    AND accepted_at IS NULL
    AND expires_at > now()
  );
REVOKE SELECT (token) ON public.tenant_invitations FROM authenticated;
GRANT SELECT ON public.tenant_invitations_for_invitee TO authenticated;
GRANT ALL ON public.tenant_invitations_for_invitee TO service_role;
