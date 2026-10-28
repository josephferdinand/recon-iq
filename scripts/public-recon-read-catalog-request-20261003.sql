-- Curie — reconciliation read port/token provenance. READ ONLY, metadata only.
-- Parent: run on PROD YOUR_PROJECT_REF and DEV YOUR_PROJECT_REF.
-- Derive actual dependencies from captured routines, including token/audit triggers.
WITH RECURSIVE helpers(oid) AS (
  SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.prokind='f' AND n.nspname IN ('public','private','auth') AND p.proname=ANY(ARRAY[
    'uid','role','jwt','guard_api_token_principal_metadata','user_can_access_recon',
    'recon_authoritative_access_decision','recon_authoritative_access_decision_as',
    'get_recon_run_result_page','get_recon_run_result_status_counts',
    'has_tenant_role','is_tenant_member','is_platform_admin','audit_log_chain','audit_log_block_mutation'])
  UNION
  SELECT p.oid FROM helpers h JOIN pg_proc parent ON parent.oid=h.oid
  JOIN pg_proc p ON position(p.proname||'(' IN replace(parent.prosrc,' ',''))>0
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.prokind='f' AND n.nspname IN ('public','private','auth')
), relations AS (
  SELECT c.oid,n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,
    pg_get_userbyid(c.relowner) AS owner,c.relacl::text AS acl
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','v','p') AND (
    c.relname=ANY(ARRAY['api_tokens','api_service_principals','tenants','tenant_members','recon_definitions','recon_runs','recon_matches','recon_exceptions','audit_log','audit_chain_head'])
    OR EXISTS(SELECT 1 FROM helpers h JOIN pg_proc p ON p.oid=h.oid
      WHERE p.prosrc ~ ('\mpublic[.]'||c.relname||'\M')))
), catalog AS (
SELECT jsonb_build_object(
 'engine',current_setting('server_version_num'),
 'ledger',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'latest',(SELECT max(version) FROM supabase_migrations.schema_migrations),
 'relations',(SELECT jsonb_agg(to_jsonb(r)-'oid' ORDER BY r.relname) FROM relations r),
 'columns',(SELECT jsonb_agg(jsonb_build_object('table',r.relname,'position',a.attnum,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text,'identity',a.attidentity,'generated',a.attgenerated) ORDER BY r.relname,a.attnum) FROM relations r JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('table',r.relname,'name',c.conname,'type',c.contype,'validated',c.convalidated,'definition',pg_get_constraintdef(c.oid)) ORDER BY r.relname,c.conname) FROM relations r JOIN pg_constraint c ON c.conrelid=r.oid),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('table',r.relname,'definition',pg_get_indexdef(i.indexrelid)) ORDER BY r.relname,pg_get_indexdef(i.indexrelid)) FROM relations r JOIN pg_index i ON i.indrelid=r.oid),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.tablename,p.policyname) FROM pg_policies p JOIN relations r ON r.nspname=p.schemaname AND r.relname=p.tablename),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('table',r.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid),'helper',pg_get_functiondef(t.tgfoid)) ORDER BY r.relname,t.tgname) FROM relations r JOIN pg_trigger t ON t.tgrelid=r.oid AND NOT t.tgisinternal),
 'helpers',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'security_definer',p.prosecdef,'volatility',p.provolatile,'definition',pg_get_functiondef(p.oid)) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) FROM helpers h JOIN pg_proc p ON p.oid=h.oid JOIN pg_namespace n ON n.oid=p.pronamespace),
 'enums',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',t.typname,'order',e.enumsortorder,'value',e.enumlabel) ORDER BY n.nspname,t.typname,e.enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'),
 'roles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'superuser',rolsuper,'bypassrls',rolbypassrls) ORDER BY rolname) FROM pg_roles WHERE rolname IN ('postgres','anon','authenticated','service_role','supabase_auth_admin'))
) AS body
)
SELECT body AS catalog,md5(body::text) AS metadata_fingerprint FROM catalog;
