-- Parent-only metadata diagnosis of the exact hosted refusal timeout. No business rows,
-- credentials, request JWTs, SQL mutations, lock changes or timeout changes are returned.
BEGIN TRANSACTION READ ONLY;
SELECT clock_timestamp() AS captured_at, version() AS engine,
       current_setting('statement_timeout') AS caller_statement_timeout,
       current_setting('lock_timeout') AS caller_lock_timeout;
SELECT n.nspname AS schema_name, p.proname, pg_get_function_identity_arguments(p.oid) AS identity,
       pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer,
       p.proconfig, p.proacl, pg_get_functiondef(p.oid) AS actual_definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE (n.nspname='public' AND p.proname IN ('withdraw_governance_membership_request','get_governance_membership_request'))
   OR (n.nspname='private' AND p.proname IN ('governance_membership_lock_scope','governance_membership_active'))
ORDER BY n.nspname,p.proname;
SELECT rolname, rolconfig FROM pg_roles WHERE rolname IN ('authenticator','authenticated','postgres');
SELECT pid, usename, application_name, state, wait_event_type, wait_event,
       clock_timestamp()-query_start AS query_age, pg_blocking_pids(pid) AS blocking_pids
FROM pg_stat_activity
WHERE pid<>pg_backend_pid() AND (query ILIKE '%withdraw_governance_membership_request%'
   OR query ILIKE '%get_governance_membership_request%')
ORDER BY query_start;
COMMIT;
