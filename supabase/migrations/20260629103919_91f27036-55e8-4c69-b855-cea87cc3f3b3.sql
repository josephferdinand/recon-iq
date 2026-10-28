
-- =============================================================
-- Revoke EXECUTE on all SECURITY DEFINER functions in `public`
-- from PUBLIC, anon, authenticated, then re-grant only those
-- intentionally callable.
-- =============================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END$$;

-- ---- Re-grant: anon-callable (public surfaces) ----
DO $$
DECLARE
  fn TEXT;
  names TEXT[] := ARRAY[
    'resolve_tenant_from_host',
    'status_subscribe',
    'status_confirm_subscriber',
    'status_unsubscribe',
    'tdv_issue_token',
    'tdv_validate_token'
  ];
  r RECORD;
BEGIN
  FOREACH fn IN ARRAY names LOOP
    FOR r IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname = fn
    LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', r.sig);
    END LOOP;
  END LOOP;
END$$;

-- ---- Re-grant: authenticated-only (app RPCs + RLS helpers) ----
DO $$
DECLARE
  fn TEXT;
  names TEXT[] := ARRAY[
    -- RLS / permission helpers (called from policies)
    'has_permission',
    'user_has_permission',
    'user_has_platform_role',
    'effective_user_permissions',
    'is_change_freeze_active',
    'bg_is_active',
    'effective_retention_days',
    'has_role',
    -- App RPCs
    'compute_recon_risk',
    'predict_break_category',
    'consume_step_up_grant',
    'find_invitation_by_token',
    'pick_next_assignee',
    'platform_user_analytics',
    'tenant_user_analytics',
    'verify_audit_chain',
    'webhook_health_stats',
    'webhook_outbox_replay',
    'worker_breaker_reset',
    'evaluate_roadmap_audit_ready',
    'sla_evaluate_breaches',
    'match_kb_chunks',
    'mark_custom_domain_verified'
  ];
  r RECORD;
BEGIN
  FOREACH fn IN ARRAY names LOOP
    FOR r IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname = fn
    LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END LOOP;
  END LOOP;
END$$;

-- service_role always retains access via default ownership; no change needed.
