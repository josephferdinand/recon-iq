-- FVI Security Regression Suite
-- Verifies the five resolved security findings (2026-06-27) still hold.
-- Run:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/security-regression.sql
-- Exits non-zero on any regression so CI can fail the build.

\set ON_ERROR_STOP on
\timing off
\echo '── FVI security regression suite ──'

-- Helper: fail with a clear message
CREATE OR REPLACE FUNCTION pg_temp.assert(cond boolean, msg text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT cond THEN
    RAISE EXCEPTION 'SECURITY REGRESSION: %', msg;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- Finding 1 & 2: email_send_log + suppressed_emails fully locked
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE tbl text; bad int;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['email_send_log','suppressed_emails']
  LOOP
    -- RLS must be enabled
    PERFORM pg_temp.assert(
      (SELECT relrowsecurity FROM pg_class
        WHERE oid = ('public.'||tbl)::regclass),
      format('%s: RLS disabled', tbl)
    );

    -- Must have a RESTRICTIVE deny policy targeting anon+authenticated
    PERFORM pg_temp.assert(
      EXISTS (
        SELECT 1 FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
        WHERE c.relname = tbl
          AND p.polpermissive = false
          AND 'anon'::regrole = ANY(p.polroles)
          AND 'authenticated'::regrole = ANY(p.polroles)
      ),
      format('%s: missing RESTRICTIVE deny policy for anon+authenticated', tbl)
    );

    -- anon/authenticated must NOT hold any DML privilege
    SELECT count(*) INTO bad
    FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name = tbl
      AND grantee IN ('anon','authenticated','PUBLIC');
    PERFORM pg_temp.assert(bad = 0,
      format('%s: %s leaked grants to anon/authenticated/PUBLIC', tbl, bad));
  END LOOP;
END $$;

\echo '  ✓ email_send_log + suppressed_emails locked to service_role'

-- ─────────────────────────────────────────────────────────────
-- Finding 3: llm_providers — platform rows readable only by platform admins
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM pg_temp.assert(
    (SELECT relrowsecurity FROM pg_class WHERE oid='public.llm_providers'::regclass),
    'llm_providers: RLS disabled'
  );
  PERFORM pg_temp.assert(
    EXISTS (
      SELECT 1 FROM pg_policy p
      JOIN pg_class c ON c.oid=p.polrelid
      WHERE c.relname='llm_providers'
        AND p.polpermissive = false
        AND p.polcmd::text IN ('r','*')
    ),
    'llm_providers: missing RESTRICTIVE read-gate for platform rows'
  );
END $$;
\echo '  ✓ llm_providers platform rows gated by RESTRICTIVE policy'

-- ─────────────────────────────────────────────────────────────
-- Finding 4 & 5: sensitive SECURITY DEFINER functions revoked from anon/authenticated
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE fn text; leaked int;
  protected_fns text[] := ARRAY[
    'enqueue_email','delete_email','move_to_dlq','read_email_batch',
    'audit_log_chain','audit_log_block_mutation',
    'purge_expired_recon_runs','bg_expire_grants',
    'tg_break_glass_uid','tg_bg_activity_block_mutation',
    'tg_data_prep_pipeline_uid','tg_data_prep_run_uid','tg_recon_run_uid',
    'tg_set_updated_at','tg_bu_set_path','rate_limit_hit','handle_new_user'
  ];
BEGIN
  FOREACH fn IN ARRAY protected_fns LOOP
    SELECT count(*) INTO leaked
    FROM information_schema.role_routine_grants
    WHERE specific_schema='public'
      AND routine_name = fn
      AND grantee IN ('anon','authenticated','PUBLIC');
    PERFORM pg_temp.assert(leaked = 0,
      format('SECURITY DEFINER %s leaks EXECUTE to anon/authenticated/PUBLIC (%s grants)', fn, leaked));
  END LOOP;
END $$;
\echo '  ✓ Sensitive SECURITY DEFINER functions hardened'

-- Audit verification is an authenticated entry point for the platform UI,
-- but the SECURITY DEFINER body must enforce a fresh platform-admin check.
DO $$
DECLARE fn_def text;
BEGIN
  SELECT pg_get_functiondef('public.verify_audit_chain(integer)'::regprocedure)
    INTO fn_def;
  PERFORM pg_temp.assert(
    has_function_privilege('authenticated', 'public.verify_audit_chain(integer)', 'EXECUTE'),
    'verify_audit_chain: authenticated entry-point grant is missing'
  );
  PERFORM pg_temp.assert(
    fn_def ILIKE '%auth.uid() is null%'
      AND fn_def ILIKE '%not public.is_platform_admin(auth.uid())%'
      AND fn_def ILIKE '%errcode = ''42501''%',
    'verify_audit_chain: platform-admin guard is missing'
  );
END $$;
\echo '  ✓ Audit verification entry point enforces platform-admin authorization'

-- ─────────────────────────────────────────────────────────────
-- Finding 6: github_sync_settings + github_sync_change_requests
--   - RLS enabled
--   - anon has zero grants
--   - authenticated may not DELETE either table (append-only / singleton)
--   - state-machine + 4-eyes guard triggers present
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE tbl text; bad int;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['github_sync_settings','github_sync_change_requests']
  LOOP
    PERFORM pg_temp.assert(
      (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||tbl)::regclass),
      format('%s: RLS disabled', tbl)
    );

    SELECT count(*) INTO bad
    FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name=tbl
      AND grantee IN ('anon','PUBLIC');
    PERFORM pg_temp.assert(bad = 0,
      format('%s: %s leaked grants to anon/PUBLIC', tbl, bad));

    SELECT count(*) INTO bad
    FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name=tbl
      AND grantee = 'authenticated' AND privilege_type = 'DELETE';
    PERFORM pg_temp.assert(bad = 0,
      format('%s: authenticated must NOT hold DELETE (append-only)', tbl));
  END LOOP;

  -- Guard triggers must exist
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM pg_trigger
            WHERE tgname='github_sync_cr_guard' AND NOT tgisinternal),
    'github_sync_change_requests: state-machine guard trigger missing'
  );
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM pg_trigger
            WHERE tgname='github_sync_settings_guard' AND NOT tgisinternal),
    'github_sync_settings: write-guard trigger missing'
  );

  -- Guard functions must be SECURITY DEFINER
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM pg_proc p
       JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public'
        AND p.proname IN ('tg_github_sync_cr_guard','tg_github_sync_settings_guard')
        AND p.prosecdef = true) = 2,
    'github_sync guard functions must be SECURITY DEFINER'
  );
END $$;
\echo '  ✓ github_sync_settings + github_sync_change_requests hardened'

-- ─────────────────────────────────────────────────────────────
-- Internal serialization / keepalive tables are never client-writable
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE tbl text; bad int;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['audit_chain_head','heartbeat'] LOOP
    PERFORM pg_temp.assert(
      (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||tbl)::regclass),
      format('%s: RLS disabled', tbl)
    );
    PERFORM pg_temp.assert(
      EXISTS (
        SELECT 1 FROM pg_policy p
        JOIN pg_class c ON c.oid=p.polrelid
        WHERE c.relname=tbl AND p.polpermissive=false
      ),
      format('%s: restrictive client-deny policy missing', tbl)
    );
    SELECT count(*) INTO bad
    FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name=tbl
      AND grantee IN ('anon','authenticated','PUBLIC');
    PERFORM pg_temp.assert(bad=0,
      format('%s: %s leaked client grants', tbl, bad));
  END LOOP;
END $$;
\echo '  ✓ Internal audit-head and keepalive tables are client-isolated'

-- An untracked PROD debug helper was callable by anon/authenticated and ran as
-- postgres. It may temporarily remain for service-role compatibility, but no
-- client role may execute it.
DO $$
BEGIN
  IF to_regprocedure('public.exec_sql(text)') IS NOT NULL THEN
    PERFORM pg_temp.assert(
      NOT (
      has_function_privilege('public', 'public.exec_sql(text)', 'EXECUTE')
      OR has_function_privilege('anon', 'public.exec_sql(text)', 'EXECUTE')
      OR has_function_privilege('authenticated', 'public.exec_sql(text)', 'EXECUTE')
      ),
      'exec_sql(text) remains executable by a client role'
    );
  END IF;
END $$;
\echo '  ✓ Untracked exec_sql debug RPC is not client-executable'

DO $$
BEGIN
  PERFORM pg_temp.assert(
    NOT EXISTS (
      SELECT 1 FROM pg_policy p
      WHERE p.polrelid = 'public.ai_model_pricing'::regclass
        AND 0 = ANY (p.polroles)
    ),
    'ai_model_pricing has a policy granted to PUBLIC'
  );
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM pg_policy p
      WHERE p.polrelid = 'public.ai_model_pricing'::regclass
        AND p.polname IN ('ai_model_pricing_read', 'ai_model_pricing_admin_write')) = 2,
    'ai_model_pricing canonical policies are incomplete'
  );
  PERFORM pg_temp.assert(
    NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.ai_model_pricing'::regclass
        AND conname = 'ai_model_pricing_provider_model_uniq'
    ),
    'ai_model_pricing still blocks time-versioned rate cards'
  );
END $$;
\echo '  ✓ AI model pricing policies and time-versioned uniqueness are canonical'

\echo '── ALL SECURITY REGRESSION CHECKS PASSED ──'
