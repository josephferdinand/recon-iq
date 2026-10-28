-- Leibniz: parent/operator SELECT-only guard for the owned QA scope.
-- No SET ROLE/JWT claims, grants, updates, timeout changes or business payload reads.
-- Metadata under an operator is not a replay of the ordinary authenticated request.
BEGIN TRANSACTION READ ONLY;

WITH qa AS (
  SELECT id FROM public.tenants
  WHERE slug = 'reconiq-assurance-lab-prod'
)
SELECT m.active, m.role,
       public.user_has_permission(m.user_id, m.tenant_id, 'audit.log.read', NULL::uuid) AS audit_read,
       public.user_has_permission(m.user_id, m.tenant_id, 'audit.log.export', NULL::uuid) AS audit_export
FROM public.tenant_members m JOIN qa ON qa.id = m.tenant_id
WHERE m.user_id = '9d8ae600-cd90-46bc-bbb0-1da3aca3db57'::uuid
LIMIT 1;

SELECT c.oid::regclass AS relation,
       c.relrowsecurity, c.relforcerowsecurity,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('data_source_runs','erp_connector_runs','parser_runs',
                   'data_prep_runs','data_source_alerts','data_source_health','audit_log');

SELECT p.oid::regprocedure AS routine, p.prosecdef AS security_definer,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       md5(pg_get_functiondef(p.oid)) AS current_definition_md5
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_exception_dashboard','user_has_permission',
                   'is_platform_admin','is_tenant_member');

SELECT name, setting, unit, source
FROM pg_settings WHERE name = 'statement_timeout';
-- This timeout belongs to the operator session. Compare the real HTTP error;
-- do not call it the PostgREST request's timeout or raise it to mask the defect.

ROLLBACK;
