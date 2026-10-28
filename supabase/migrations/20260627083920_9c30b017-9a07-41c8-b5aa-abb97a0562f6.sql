
-- 1. tenant_slug_history: restrict to authenticated tenant members or platform admins
DROP POLICY IF EXISTS "Anyone reads slug history" ON public.tenant_slug_history;
CREATE POLICY "Tenant members read slug history"
  ON public.tenant_slug_history FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));

-- 2. data_source_schedules: restrict writes to tenant_admin / tenant_analyst / platform admin
DROP POLICY IF EXISTS dss_write ON public.data_source_schedules;
CREATE POLICY dss_write ON public.data_source_schedules
  FOR ALL TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
    OR public.is_platform_admin(auth.uid())
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)
    OR public.is_platform_admin(auth.uid())
  );

-- 3. kb_categories: require authentication for platform-scoped reads
DROP POLICY IF EXISTS "kb cat read platform" ON public.kb_categories;
CREATE POLICY "kb cat read platform" ON public.kb_categories
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND (
      scope = 'platform'::kb_scope
      OR (scope = 'tenant'::kb_scope AND public.is_tenant_member(auth.uid(), tenant_id))
      OR public.is_platform_admin(auth.uid())
    )
  );

-- 4. notifications: only service_role can insert (clients cannot forge notifications)
DROP POLICY IF EXISTS "notifications service insert" ON public.notifications;
-- service_role bypasses RLS, so no INSERT policy is needed for it.

-- 5. Set immutable search_path on functions missing it
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pg_temp;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pg_temp;

-- 6. Revoke EXECUTE from anon/authenticated on SECURITY DEFINER functions that
--    must never be invoked directly by clients (used only by server/admin/triggers).
REVOKE EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.verify_audit_chain(integer) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.audit_log_chain() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.ip_in_tenant_allowlist(uuid, text) FROM anon, authenticated, public;
-- NOTE: has_platform_role, has_tenant_role, is_platform_admin, is_tenant_member,
-- and has_active_subscription remain EXECUTE-able by authenticated because RLS
-- policies across the schema call them as the querying user.
