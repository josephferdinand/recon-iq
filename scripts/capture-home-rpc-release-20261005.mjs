import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const privateRoot='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925';
const vault=await readFile('./.private/CREDENTIALS.md','utf8');
const a=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),b=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');
if(a<0||b<=a)throw Error('FVI credential boundary');
const token=vault.slice(a,b).split(/\r?\n/).find(x=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(x))?.split('|')[2]?.trim().replace(/^`|`$/g,'');
if(!/^sbp_/.test(token??''))throw Error('FVI credential unavailable');
for(const [environment,ref] of [['PROD','YOUR_PROJECT_REF'],['DEV','YOUR_PROJECT_REF']]){
 const query="SELECT current_setting('server_version_num') AS engine,(SELECT count(*)::int FROM supabase_migrations.schema_migrations) AS ledger,(SELECT max(version::text) FROM supabase_migrations.schema_migrations) AS latest,(SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'args',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'definition_md5',md5(p.prosrc),'acl',p.proacl,'config',p.proconfig)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_workspace_dashboard_team_scope') AS routines";
 const r=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({query,read_only:true}),signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error('Home RPC metadata HTTP '+r.status);
 const rows=await r.json(),record={at:new Date().toISOString(),environment,ref,rows};
 const file=privateRoot+'/FVI-HOME-RPC-CURRENT-'+environment+'-'+Date.now()+'.json';
 const bytes=JSON.stringify(record,null,2);await writeFile(file,bytes,{flag:'wx'});
 console.log(JSON.stringify({environment,file,sha256:createHash('sha256').update(bytes).digest('hex'),...rows[0]}));
}
