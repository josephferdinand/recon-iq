-- Leibniz — actual Reports718 data read failure; SELECT-only parent diagnosis. NOT RUN.
-- No JWT/role injection, grant, SQL apply or business/secret value dump.
BEGIN TRANSACTION READ ONLY;
SELECT current_database(),current_setting('server_version');
WITH expected(table_name,column_name) AS (VALUES
 ('business_units','id'),('business_units','name'),('business_units','is_archived'),
 ('audit_log','id'),('audit_log','occurred_at'),('audit_log','actor_email'),('audit_log','actor_user_id'),('audit_log','scope'),('audit_log','action'),('audit_log','resource_type'),('audit_log','client_ip'),
 ('security_events','id'),('security_events','occurred_at'),('security_events','event_type'),('security_events','severity'),('security_events','ip'),('security_events','user_id'),
 ('ai_usage_events','id'),('ai_usage_events','created_at'),('ai_usage_events','scope'),('ai_usage_events','model'),('ai_usage_events','tokens_in'),('ai_usage_events','tokens_out'),('ai_usage_events','cost_usd'),('ai_usage_events','user_id'),
 ('recon_runs','id'),('recon_runs','definition_id'),('recon_runs','total_rows'),('recon_runs','stats'),
 ('recon_exceptions','id'),('recon_exceptions','due_date'),('recon_exceptions','root_cause'),('recon_exceptions','lifecycle_state'),
 ('support_tickets','id'),('support_tickets','priority'),('support_tickets','resolved_at'),
 ('recon_schedules','id'),('recon_schedules','enabled'),('recon_schedules','definition_id'),
 ('tenant_ip_allowlist','id'),('tenant_sso_configs','id'),('tenant_sso_configs','enabled'),
 ('tenant_security_settings','tenant_id'),('tenant_ai_settings','tenant_id'),('tenant_members','id'),('tenant_members','user_id'),('tenant_members','role'),('tenant_members','active'))
SELECT e.table_name,e.column_name, a.attnum IS NOT NULL AS column_present,
       pg_catalog.format_type(a.atttypid,a.atttypmod) AS actual_type
FROM expected e LEFT JOIN pg_catalog.pg_attribute a
 ON a.attrelid=to_regclass('public.'||e.table_name) AND a.attname=e.column_name AND a.attnum>0 AND NOT a.attisdropped
ORDER BY e.table_name,e.column_name;
SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
 has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_base_select
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('business_units','audit_log','security_events','ai_usage_events','recon_runs','recon_exceptions','support_tickets','recon_schedules','tenant_ip_allowlist','tenant_sso_configs','tenant_security_settings','tenant_ai_settings','tenant_members');
SELECT tablename,policyname,roles,cmd,qual,with_check
FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename IN ('business_units','audit_log','security_events','ai_usage_events','recon_runs','recon_exceptions','support_tickets','recon_schedules','tenant_ip_allowlist','tenant_sso_configs','tenant_security_settings','tenant_ai_settings','tenant_members') AND cmd IN ('SELECT','ALL');
SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),md5(pg_get_functiondef(p.oid)) AS definition_md5
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='get_recon_list_scope_ids';
SELECT role::text,active FROM public.tenant_members
WHERE tenant_id='aa5ed999-69eb-41a0-a9c6-fbb439efcffb'::uuid AND user_id='9d8ae600-cd90-46bc-bbb0-1da3aca3db57'::uuid;
ROLLBACK;
-- Actual HTTP200 serialized error is generic: Report data could not be loaded. Retry the report.
-- Parent must diagnose exact failed caller query/columns/ACL/RLS with the current ordinary request.
-- Operator metadata is not authenticated HTTP proof; do not grant broadly or substitute admin reads.
