import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const vault=await readFile('./.private/CREDENTIALS.md','utf8');
const start=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),end=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');
if(start<0||end<=start)throw Error('Canonical credential section unavailable');
const token=vault.slice(start,end).split(/\r?\n/).find(x=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(x))?.split('|')[2]?.trim().replace(/^`|`$/g,'');
if(!/^sbp_[A-Za-z0-9_-]{20,}$/.test(token??''))throw Error('Management access unavailable');
const query=`WITH relations AS (
 SELECT c.oid,n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner,c.relacl::text
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname=ANY(ARRAY['api_tokens','tenants','tenant_memberships','tenant_members','recon_definitions','recon_runs','audit_log','tenant_roles','user_roles','user_business_units','user_group_memberships','data_resource_owners','data_resource_grants'])
)
SELECT jsonb_build_object(
 'engine',current_setting('server_version_num'),'ledger',(SELECT count(*) FROM supabase_migrations.schema_migrations),'latest',(SELECT max(version) FROM supabase_migrations.schema_migrations),
 'relations',(SELECT coalesce(jsonb_agg(to_jsonb(r)-'oid'),'[]') FROM relations r),
 'columns',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',r.relname,'attnum',a.attnum,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY r.relname,a.attnum),'[]') FROM relations r JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum),
 'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',r.relname,'name',k.conname,'definition',pg_get_constraintdef(k.oid,true)) ORDER BY r.relname,k.conname),'[]') FROM relations r JOIN pg_constraint k ON k.conrelid=r.oid),
 'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',r.relname,'definition',pg_get_indexdef(i.indexrelid)) ORDER BY r.relname,i.indexrelid),'[]') FROM relations r JOIN pg_index i ON i.indrelid=r.oid),
 'policies',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',r.relname,'name',p.polname,'command',p.polcmd,'roles',p.polroles,'qual',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY r.relname,p.polname),'[]') FROM relations r JOIN pg_policy p ON p.polrelid=r.oid),
 'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',r.relname,'name',t.tgname,'definition',pg_get_triggerdef(t.oid,true),'function',t.tgfoid::regprocedure::text,'enabled',t.tgenabled) ORDER BY r.relname,t.tgname),'[]') FROM relations r JOIN pg_trigger t ON t.tgrelid=r.oid AND NOT t.tgisinternal),
 'helpers',(SELECT coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'definition',pg_get_functiondef(p.oid)) ORDER BY n.nspname,p.proname,p.oid),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private','auth') AND p.proname=ANY(ARRAY['uid','role','jwt','effective_user_permissions','recon_authoritative_access_decision','recon_authoritative_access_decision_as','get_recon_run_result_page','get_recon_run_result_status_counts','actor_can_read_bu','actor_has_permission','has_tenant_role','has_platform_role','active_tenant_admin','audit_log_block_mutation','audit_log_chain','data_resource_shadow_allows_actor','recon_multi_bu_shadow_allows_actor']))
) AS catalog`;
for(const [environment,ref] of [['PROD','YOUR_PROJECT_REF'],['DEV','YOUR_PROJECT_REF']]){
 const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({read_only:true,query}),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(`${environment} read-only catalog HTTP${response.status}; body withheld`);
 const rows=await response.json();if(rows.length!==1||!rows[0].catalog)throw Error('Catalog envelope unavailable');
 const result={at:new Date().toISOString(),environment,ref,read_only:true,querySha256:createHash('sha256').update(query).digest('hex'),...rows[0].catalog};
 const bytes=JSON.stringify(result,null,2),file=`./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/FVI-PUBLIC-API-CATALOG-${environment}-20261003.json`;
 await writeFile(file,bytes);console.log(JSON.stringify({environment,file,sha256:createHash('sha256').update(bytes).digest('hex'),ledger:result.ledger,latest:result.latest,relations:result.relations.length,columns:result.columns.length,helpers:result.helpers.length,noBusinessRowsCaptured:true}));
}
