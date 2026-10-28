-- Curie — current token issuance/revocation privileged-assurance metadata only.
-- No users, MFA factor secrets, tokens, security-setting values or business rows.
WITH relations AS (
 SELECT c.oid,n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,
   pg_get_userbyid(c.relowner) AS owner,c.relacl::text AS acl
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','v','p') AND (c.relname IN ('api_tokens','tenant_security_settings','tenant_members')
   OR c.relname ~ '(assurance|privileged|security_policy|security_policies|session_policy)')
)
SELECT jsonb_build_object(
 'ledger',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'latest',(SELECT max(version) FROM supabase_migrations.schema_migrations),
 'engine',current_setting('server_version_num'),
 'pre_request_setting',current_setting('pgrst.db_pre_request',true),
 'pre_request_role_settings',(SELECT jsonb_agg(jsonb_build_object('role',coalesce(r.rolname,'ALL'),'database',coalesce(d.datname,'ALL'),'setting',setting) ORDER BY r.rolname,d.datname,setting) FROM pg_db_role_setting s LEFT JOIN pg_roles r ON r.oid=s.setrole LEFT JOIN pg_database d ON d.oid=s.setdatabase CROSS JOIN LATERAL unnest(s.setconfig) setting WHERE setting LIKE 'pgrst.db_pre_request=%'),
 'relations',(SELECT jsonb_agg(to_jsonb(r)-'oid' ORDER BY relname) FROM relations r),
 'columns',(SELECT jsonb_agg(jsonb_build_object('table',r.relname,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'position',a.attnum,'not_null',a.attnotnull,'generated',a.attgenerated,'identity',a.attidentity,'acl',a.attacl::text,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY r.relname,a.attnum) FROM relations r JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.tablename,p.policyname) FROM pg_policies p JOIN relations r ON r.nspname=p.schemaname AND r.relname=p.tablename),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('table',r.relname,'name',k.conname,'definition',pg_get_constraintdef(k.oid)) ORDER BY r.relname,k.conname) FROM relations r JOIN pg_constraint k ON k.conrelid=r.oid),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('table',r.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid),'helper',pg_get_functiondef(t.tgfoid)) ORDER BY r.relname,t.tgname) FROM relations r JOIN pg_trigger t ON t.tgrelid=r.oid AND NOT t.tgisinternal),
 'helpers',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'definition',pg_get_functiondef(p.oid)) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind='f' AND n.nspname IN ('public','private','auth') AND (
   p.proname IN ('uid','role','jwt','has_tenant_role','is_platform_admin','is_tenant_member','guard_api_token_principal_metadata')
   OR p.proname ~ '(mfa|aal|assurance|privileged|security_policy|security_policies)'
   OR p.prosrc ~* '(aal2|mfa_required|privileged_assurance)'))
) AS catalog;
