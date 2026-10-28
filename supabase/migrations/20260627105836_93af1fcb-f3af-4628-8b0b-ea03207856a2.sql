
-- 1) llm_providers: restrict credential metadata to admins only.
DROP POLICY IF EXISTS "tenant members read tenant llm" ON public.llm_providers;

CREATE POLICY "tenant members read tenant llm (non-key cols)"
  ON public.llm_providers
  FOR SELECT
  TO authenticated
  USING (scope = 'tenant'::llm_scope AND public.is_tenant_member(auth.uid(), tenant_id));

REVOKE SELECT ON public.llm_providers FROM authenticated;
GRANT SELECT (
  id, scope, tenant_id, provider, display_name, base_url, model,
  is_active, created_by, created_at, updated_at
) ON public.llm_providers TO authenticated;
-- key_fingerprint, key_last4, key_secret_name remain unreadable to ordinary members.
GRANT ALL ON public.llm_providers TO service_role;

-- 2) ai_usage_events: explicit INSERT + immutability from clients.
CREATE POLICY "aue_insert_tenant_members"
  ON public.ai_usage_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_tenant_member(auth.uid(), tenant_id)
    AND (user_id IS NULL OR user_id = auth.uid())
  );
CREATE POLICY "aue_no_update"
  ON public.ai_usage_events
  FOR UPDATE
  TO authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY "aue_no_delete"
  ON public.ai_usage_events
  FOR DELETE
  TO authenticated
  USING (false);

-- 3) tenant_invitations: no more token leakage via email-claim matching.
DROP POLICY IF EXISTS "invitee can read own by token" ON public.tenant_invitations;

CREATE POLICY "invitee can see own invitations (no token)"
  ON public.tenant_invitations
  FOR SELECT
  TO authenticated
  USING (
    auth.jwt() ->> 'email' IS NOT NULL
    AND lower(email::text) = lower(auth.jwt() ->> 'email')
    AND accepted_at IS NULL
    AND expires_at > now()
  );

REVOKE SELECT ON public.tenant_invitations FROM authenticated;
GRANT SELECT (
  id, tenant_id, email, role, invited_by, accepted_at, accepted_by, expires_at, created_at
) ON public.tenant_invitations TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.tenant_invitations TO authenticated;
GRANT ALL ON public.tenant_invitations TO service_role;

-- 4) SECURITY DEFINER surface reduction.
REVOKE EXECUTE ON FUNCTION public.has_active_subscription(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_active_subscription(uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.verify_audit_chain(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.purge_expired_recon_runs() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ip_in_tenant_allowlist(uuid, text) FROM PUBLIC, anon, authenticated;

-- RLS-critical helpers: keep authenticated EXECUTE (required for policy evaluation) but revoke anon.
REVOKE EXECUTE ON FUNCTION public.is_platform_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_tenant_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_tenant_role(uuid, uuid, tenant_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_platform_role(uuid, platform_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_can_access_recon(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_has_tenant_role_or_group(uuid, uuid, tenant_role) FROM PUBLIC, anon;
