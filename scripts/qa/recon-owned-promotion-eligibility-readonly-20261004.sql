SELECT current_setting('server_version_num') AS engine,
 (SELECT count(*) FROM supabase_migrations.schema_migrations) AS ledger,
 (SELECT max(version::text) FROM supabase_migrations.schema_migrations) AS latest,
 (SELECT jsonb_agg(jsonb_build_object('id',id,'tenant_id',tenant_id,'created_by',created_by,'access_mode',access_mode,'environment',environment,'governance_state',governance_state,'governance_parent_id',governance_parent_id))
 FROM public.recon_definitions WHERE tenant_id='aa5ed999-69eb-41a0-a9c6-fbb439efcffb'::uuid AND id='8f11c44c-4651-4ef3-a34a-2fa764ea7aa4'::uuid) AS owned_definition_metadata,
 (SELECT count(*) FROM public.recon_definition_governance_requests WHERE tenant_id='aa5ed999-69eb-41a0-a9c6-fbb439efcffb'::uuid AND staging_definition_id='8f11c44c-4651-4ef3-a34a-2fa764ea7aa4'::uuid) AS owned_request_count,
 (SELECT count(*) FROM public.recon_definition_governance_audit WHERE tenant_id='aa5ed999-69eb-41a0-a9c6-fbb439efcffb'::uuid AND staging_definition_id='8f11c44c-4651-4ef3-a34a-2fa764ea7aa4'::uuid AND event_type='promotion_submitted') AS owned_submit_audit_count,
 (SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) ORDER BY c.relname,a.attnum)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname IN ('recon_definition_business_units','recon_definition_bu_grants') AND a.attnum>0 AND NOT a.attisdropped) AS scope_columns;
