import{readFile,writeFile}from'node:fs/promises';
import{createHash}from'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
const root='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925';
const vault=await readFile('./.private/CREDENTIALS.md','utf8');
const start=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),end=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');if(start<0||end<=start)throw Error('FVI authority boundary');
const token=vault.slice(start,end).split(/\r?\n/).find(x=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(x))?.split('|')[2]?.trim().replace(/^`|`$/g,'');if(!/^sbp_/.test(token??''))throw Error('FVI authority unavailable');
const inputs=[['copilot','output/copilot-selected-rebase-20261005/COPILOT-CURRENT457432-METADATA.sql'],['recovery_root','output/recovery-lifecycle-complete-recovery-20261005/sql/catalog-capture.sql'],['recovery_consumed','output/recovery-current-457-432-qualified-20261005/consumed-shapes.sql']];
const queries=[];
for(const[kind,file]of inputs){const sql=await readFile(file,'utf8');if(!/^\s*(WITH|SELECT)\b/i.test(sql.replace(/^--.*$/gm,'')))throw Error('Declared SELECT source required');queries.push({kind,source:file,querySHA256:sha(sql),sql});}
const access=`SELECT jsonb_build_object('routines',(SELECT jsonb_agg(jsonb_build_object('oid',p.oid::text,'schema',n.nspname,'name',p.proname,'prosrc',p.prosrc,'definition',pg_get_functiondef(p.oid),'attributes',to_jsonb(p),'arguments',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid)) ORDER BY n.nspname,p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='private' AND p.proname IN('fvi_active_structure_admin','fvi_structure_write_context','fvi_bu_structure_guard','fvi_group_structure_guard','fvi_seed_missing_group_presets')) OR (n.nspname='public' AND p.proname IN('seed_tenant_group_presets_for_bu','seed_default_tenant_groups'))),'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY polname) FROM pg_policy p WHERE (p.polrelid='public.business_units'::regclass AND p.polname='bu_write') OR (p.polrelid='public.tenant_groups'::regclass AND p.polname='tg_admin')),'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY tgname) FROM pg_trigger t WHERE t.tgname IN('a_fvi_bu_structure_write_guard','a_fvi_group_structure_write_guard'))) AS access_coupling`;
queries.push({kind:'access_coupling',source:'exact metadata-only seven Access helpers/two policies/two triggers',querySHA256:sha(access),sql:access});
const identity="SELECT current_setting('server_version_num') AS engine,(SELECT count(*)::int FROM supabase_migrations.schema_migrations) AS ledger,(SELECT max(version::text) FROM supabase_migrations.schema_migrations) AS latest";
async function query(ref,sql){const response=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({query:sql,read_only:true}),signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Metadata capture HTTP'+response.status);return response.json();}
const results=[];
for(const[environment,ref,ledger]of[['PROD','YOUR_PROJECT_REF',458],['DEV','YOUR_PROJECT_REF',433]]){
 const actual=(await query(ref,identity))[0];if(actual.engine!=='170006'||actual.ledger!==ledger||actual.latest!=='20261005080000')throw Error('Exact current successor identity drift');
 const captures=[];for(const item of queries){const rows=await query(ref,item.sql);captures.push({kind:item.kind,source:item.source,querySHA256:item.querySHA256,rows});}
 const file=root+'/FVI-CORE-SUCCESSOR-METADATA-'+environment+'-458-433-'+Date.now()+'.json';
 const value={at:new Date().toISOString(),environment,ref,actual,readOnly:true,noBusinessAuthFactorSecretRows:true,captures};
 await writeFile(file,JSON.stringify(value,null,2),{flag:'wx'});
 const receipt={environment,ref,actual,file,sha256:sha(await readFile(file)),kinds:captures.map(x=>x.kind),readOnly:true};results.push(receipt);console.log(JSON.stringify(receipt));
}
await writeFile('docs/evidence/FVI_CORE_SUCCESSOR_METADATA_2026-10-05-'+Date.now()+'.json',JSON.stringify({at:new Date().toISOString(),results,noSqlApplied:true},null,2),{flag:'wx'});
