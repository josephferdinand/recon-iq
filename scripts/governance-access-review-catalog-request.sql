-- Read-only supplemental metadata. No application/identity/credential rows.
SELECT jsonb_build_object(
 'engine',current_setting('server_version_num'),
 'columns',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',a.attname,
   'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'position',a.attnum,
   'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) ORDER BY c.relname,a.attnum)
   FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped AND c.relname=ANY(ARRAY[
    'bu_group_assignments','bu_user_assignments','rbac_user_grants','teams','team_members','recon_definitions',
    'recon_definition_business_units','recon_definition_bu_grants','data_resource_registry','data_resource_registry_owner_bu',
    'data_resource_registry_grants','data_resource_bu_grants','audit_chain_head','permissions'])),
 'helpers',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,
   'identity',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid)) ORDER BY n.nspname,p.proname)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind='f' AND
   ((n.nspname='public' AND p.proname=ANY(ARRAY['effective_user_permissions','audit_log_chain','audit_log_block_mutation']))
    OR (n.nspname='private' AND p.proname=ANY(ARRAY['actor_can_read_bu','has_platform_role','recon_multi_bu_shadow_allows_actor','data_resource_shadow_allows_actor'])))),
 'enums',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',t.typname,'value',e.enumlabel,'order',e.enumsortorder) ORDER BY n.nspname,t.typname,e.enumsortorder)
   FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',x.conname,'type',x.contype,'definition',pg_get_constraintdef(x.oid,true)) ORDER BY c.relname,x.conname)
   FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY(ARRAY[
    'bu_group_assignments','bu_user_assignments','rbac_user_grants','teams','team_members','recon_definitions',
    'recon_definition_business_units','recon_definition_bu_grants','data_resource_registry','data_resource_registry_owner_bu',
    'data_resource_registry_grants','data_resource_bu_grants','audit_chain_head','permissions']))
) AS catalog;
