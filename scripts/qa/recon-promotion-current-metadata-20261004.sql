SELECT current_setting('server_version_num') AS engine,
 (SELECT count(*) FROM supabase_migrations.schema_migrations) AS ledger,
 (SELECT max(version::text) FROM supabase_migrations.schema_migrations) AS latest,
 jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,'identity',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'source',p.prosrc,'source_sha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),'config',p.proconfig,'acl',p.proacl::text) ORDER BY p.proname) AS functions
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND p.proname IN ('submit_recon_definition_promotion','decide_recon_definition_promotion','request_recon_definition_edit','decide_recon_definition_edit');
