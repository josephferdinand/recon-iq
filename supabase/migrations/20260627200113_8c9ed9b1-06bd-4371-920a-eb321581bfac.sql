
-- ============================================================
-- 1) email_send_log + suppressed_emails — defence-in-depth lock
-- ============================================================
REVOKE ALL ON public.email_send_log FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.suppressed_emails FROM anon, authenticated, PUBLIC;
GRANT  ALL ON public.email_send_log  TO service_role;
GRANT  ALL ON public.suppressed_emails TO service_role;

-- Add explicit RESTRICTIVE deny so any future PERMISSIVE policy cannot
-- accidentally expose recipient addresses to authenticated/anon roles.
DROP POLICY IF EXISTS "deny_non_service_role" ON public.email_send_log;
CREATE POLICY "deny_non_service_role"
  ON public.email_send_log
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "deny_non_service_role" ON public.suppressed_emails;
CREATE POLICY "deny_non_service_role"
  ON public.suppressed_emails
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- ============================================================
-- 2) llm_providers — explicit platform-scope read policy
-- ============================================================
DROP POLICY IF EXISTS "platform scope readable by platform admins only" ON public.llm_providers;
CREATE POLICY "platform scope readable by platform admins only"
  ON public.llm_providers
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    scope <> 'platform'
    OR public.is_platform_admin(auth.uid())
  );

-- ============================================================
-- 3) Lock down SECURITY DEFINER functions that should NOT be
--    callable by anon / authenticated.
--    RLS-helper functions (has_role, is_platform_admin, etc.)
--    are intentionally left executable.
-- ============================================================
DO $$
DECLARE
  fn text;
  privileged_fns text[] := ARRAY[
    -- email queue plumbing
    'public.read_email_batch(text,integer,integer)',
    'public.enqueue_email(text,jsonb)',
    'public.delete_email(text,bigint)',
    'public.move_to_dlq(text,text,bigint,jsonb)',
    -- audit / retention / cron
    'public.verify_audit_chain(integer)',
    'public.purge_expired_recon_runs()',
    'public.bg_expire_grants()',
    'public.rate_limit_hit(text,integer,integer)',
    -- trigger-only or admin-only helpers
    'public.handle_new_user()',
    'public.audit_log_chain()',
    'public.tg_set_updated_at()',
    'public.audit_log_block_mutation()',
    'public.tg_data_prep_pipeline_uid()',
    'public.tg_data_prep_run_uid()',
    'public.tg_recon_run_uid()',
    'public.tg_break_glass_uid()',
    'public.tg_bg_activity_block_mutation()',
    'public.tg_bu_set_path()',
    'public.kb_build_body(text,text,text,text)'
  ];
BEGIN
  FOREACH fn IN ARRAY privileged_fns LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    EXCEPTION WHEN undefined_function THEN
      -- skip if signature drifted; we still want the rest applied
      NULL;
    END;
  END LOOP;
END $$;
