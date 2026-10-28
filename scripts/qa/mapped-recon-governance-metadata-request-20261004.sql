-- Parent READ ONLY in CURRENT PROD452/DEV430/latest20261004033000.
-- Consumed governance/authoritative access/mapping/assurance/audit catalog ONLY;
-- no definitions, requests, settings values, identities or credential rows.
WITH RECURSIVE helper_ids(oid) AS (
 SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE p.prokind='f' AND n.nspname IN ('public','private','auth') AND (
  p.proname=ANY(ARRAY['uid','role','jwt','request_recon_definition_edit','decide_recon_definition_edit',
   'submit_recon_definition_promotion','decide_recon_definition_promotion',
   'recon_governance_is_active_admin','recon_governance_is_active_analyst','recon_definition_config_snapshot',
   'tg_guard_recon_definition_governance','require_recon_multi_bu_owner','validate_recon_definition_bu_grant',
   'guard_recon_multi_bu_owner_mapping','reject_recon_owner_mapping_update','reject_recon_governance_history_mutation',
   'tg_guard_recon_run_governance','recon_root_write_allowed','recon_authoritative_access_decision','recon_authoritative_access_decision_as',
   'user_can_access_recon','audit_log_chain','audit_log_block_mutation','tg_set_updated_at'])
  OR p.proname ILIKE '%assurance%' OR p.proname ILIKE '%mfa%' OR p.proname ILIKE '%recon%owner%bind%'
  OR p.proname ILIKE '%recon%grant%guard%' OR p.proname ILIKE '%recon%mapping%guard%')
 UNION
 SELECT child.oid FROM helper_ids h JOIN pg_proc parent ON parent.oid=h.oid
 JOIN pg_proc child ON position(child.proname||'(' IN replace(parent.prosrc,' ',''))>0
 JOIN pg_namespace n ON n.oid=child.pronamespace
 WHERE child.prokind='f' AND n.nspname IN ('public','private','auth')
), relation_ids AS (
 SELECT c.oid,n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,
  pg_get_userbyid(c.relowner) AS owner,c.relacl::text AS acl
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','v','p') AND (
  c.relname=ANY(ARRAY['recon_definitions','recon_definition_governance_requests','recon_definition_governance_audit',
   'recon_definition_approved_versions','recon_retirement_requests','recon_definition_business_units','recon_definition_bu_grants',
   'business_units','bu_user_assignments','bu_group_assignments','tenant_members','tenant_groups','tenant_group_members',
   'recon_runs','recon_definition_business_unit_audit','recon_definition_bu_admin_audit',
   'recon_permissions','audit_log','audit_chain_head','tenant_security_settings','tenant_identity_policies','tenants'])
  OR EXISTS(SELECT 1 FROM helper_ids h JOIN pg_proc p ON p.oid=h.oid WHERE p.prosrc ~ ('\m'||n.nspname||'[.]'||c.relname||'\M')))
)
SELECT jsonb_build_object(
 'engine',current_setting('server_version_num'),'ledger',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'latest',(SELECT max(version) FROM supabase_migrations.schema_migrations),
 'relations',(SELECT jsonb_agg(to_jsonb(r)-'oid' ORDER BY r.nspname,r.relname) FROM relation_ids r),
 'columns',(SELECT jsonb_agg(jsonb_build_object('schema',r.nspname,'table',r.relname,'name',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text,'identity',a.attidentity,'generated',a.attgenerated) ORDER BY r.nspname,r.relname,a.attnum) FROM relation_ids r JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('schema',r.nspname,'table',r.relname,'name',k.conname,'type',k.contype,'validated',k.convalidated,'definition',pg_get_constraintdef(k.oid)) ORDER BY r.nspname,r.relname,k.conname) FROM relation_ids r JOIN pg_constraint k ON k.conrelid=r.oid),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('schema',r.nspname,'table',r.relname,'name',ic.relname,'definition',pg_get_indexdef(i.indexrelid)) ORDER BY r.nspname,r.relname,ic.relname) FROM relation_ids r JOIN pg_index i ON i.indrelid=r.oid JOIN pg_class ic ON ic.oid=i.indexrelid),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.schemaname,p.tablename,p.policyname) FROM pg_policies p JOIN relation_ids r ON r.nspname=p.schemaname AND r.relname=p.tablename),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('schema',r.nspname,'table',r.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid),'helper',pg_get_functiondef(t.tgfoid)) ORDER BY r.nspname,r.relname,t.tgname) FROM relation_ids r JOIN pg_trigger t ON t.tgrelid=r.oid AND NOT t.tgisinternal),
 'helpers',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'security_definer',p.prosecdef,'volatility',p.provolatile,'source',p.prosrc,'source_sha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),'definition',pg_get_functiondef(p.oid)) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) FROM helper_ids h JOIN pg_proc p ON p.oid=h.oid JOIN pg_namespace n ON n.oid=p.pronamespace),
 'enums',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',t.typname,'order',e.enumsortorder,'value',e.enumlabel) ORDER BY n.nspname,t.typname,e.enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE EXISTS(SELECT 1 FROM relation_ids r JOIN pg_attribute a ON a.attrelid=r.oid WHERE a.atttypid=t.oid OR a.atttypid=t.typarray)),
 'roles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'superuser',rolsuper,'bypassrls',rolbypassrls) ORDER BY rolname) FROM pg_roles WHERE rolname IN ('postgres','anon','authenticated','service_role','supabase_auth_admin')),
 'version_collision',(SELECT jsonb_agg(version::text) FROM supabase_migrations.schema_migrations WHERE version::text='20261004080000')
) AS catalog;
