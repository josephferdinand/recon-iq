DO $$
DECLARE
  r record;
  keep_anon text[] := ARRAY['list_public_auth_providers'];
  internal_only text[] := ARRAY[
    'handle_new_user','guard_last_tenant_owner','agent_actions_no_self_approve',
    'audit_scim_provisioning_settings_change','consume_platform_invitations_on_profile',
    'audit_log_chain','bg_expire_grants','enforce_sod_on_grant','evaluate_rls_alerts',
    'evaluate_security_alerts','evaluate_roadmap_audit_ready','email_queue_dispatch',
    'email_queue_wake','enqueue_email','delete_email','dump_public_schema_ddl',
    'aidp_purge_stale_pages','aidp_api_quota_hit','ip_in_tenant_allowlist',
    'claim_regulatory_install','complete_regulatory_install','fail_regulatory_install',
    'has_active_subscription','compute_recon_risk','hash_sandbox_client_secret'
  ];
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    IF NOT (r.proname = ANY(keep_anon)) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon, PUBLIC', r.proname, r.args);
    END IF;
    IF r.proname = ANY(internal_only) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM authenticated', r.proname, r.args);
    END IF;
  END LOOP;
END $$;