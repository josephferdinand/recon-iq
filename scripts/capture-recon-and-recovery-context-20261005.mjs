import{readFile,writeFile}from'node:fs/promises';
import{createHash}from'node:crypto';
const privateRoot='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925',sha=x=>createHash('sha256').update(x).digest('hex');
const vault=await readFile('./.private/CREDENTIALS.md','utf8'),start=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),end=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');if(start<0||end<=start)throw Error('FVI authority boundary');
const token=vault.slice(start,end).split(/\r?\n/).find(x=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(x))?.split('|')[2]?.trim().replace(/^`|`$/g,'');if(!/^sbp_/.test(token??''))throw Error('FVI authority unavailable');
const requests=JSON.parse(await readFile('output/recon-atomic-completion-next-20261005/REQUEST-HASHES.json','utf8'));
const queries=[];
for(const item of requests.files.filter(x=>x.path.endsWith('.SELECT.sql'))){const sql=await readFile('output/recon-atomic-completion-next-20261005/'+item.path,'utf8');if(sha(sql)!==item.sha256||!/^\s*(WITH|SELECT)\b/i.test(sql.replace(/^--.*$/gm,'')))throw Error('Exact declared atomic metadata SELECT');queries.push({kind:'atomic_'+item.path,sql,readOnly:true});}
const consumed=await readFile('output/recovery-current-457-432-qualified-20261005/consumed-shapes.sql','utf8');if(!/^\s*WITH\b/i.test(consumed.replace(/^--.*$/gm,'')))throw Error('Declared consumed metadata SELECT');
queries.push({kind:'recovery_exact_write_transport_context',sql:"BEGIN; SET TRANSACTION ISOLATION LEVEL REPEATABLE READ; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s';\n"+consumed+"\nROLLBACK;",readOnly:false});
const identity="SELECT current_setting('server_version_num') AS engine,(SELECT count(*)::int FROM supabase_migrations.schema_migrations) AS ledger,(SELECT max(version::text) FROM supabase_migrations.schema_migrations) AS latest";
async function query(ref,sql,readOnly){const response=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({query:sql,read_only:readOnly}),signal:AbortSignal.timeout(45000)});if(!response.ok)throw Error('Metadata-only transport HTTP'+response.status);return response.json();}
const results=[];
for(const[environment,ref,ledger]of[['PROD','YOUR_PROJECT_REF',458],['DEV','YOUR_PROJECT_REF',433]]){
 const before=(await query(ref,identity,true))[0];if(before.engine!=='170006'||before.ledger!==ledger||before.latest!=='20261005080000')throw Error('Exact metadata target');
 const captures=[];for(const p of queries){captures.push({kind:p.kind,querySHA256:sha(p.sql),providerReadOnlyFlag:p.readOnly,metadataOnlyNoDDL:true,rows:await query(ref,p.sql,p.readOnly)});}
 const after=(await query(ref,identity,true))[0];if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Metadata read current ledger drift');
 const file=privateRoot+'/FVI-RECON-ATOMIC-RECOVERY-CONTEXT-'+environment+'-'+Date.now()+'.json';await writeFile(file,JSON.stringify({at:new Date().toISOString(),environment,ref,before,captures,after,noDDLOrBusinessDataRead:true,noSQLCommitted:true},null,2),{flag:'wx'});
 const result={environment,ref,actual:after,file,sha256:sha(await readFile(file)),captures:captures.map(x=>x.kind),noSQLCommitted:true};results.push(result);console.log(JSON.stringify(result));
}
await writeFile('docs/evidence/FVI_RECON_RECOVERY_CONTEXT_CAPTURE_2026-10-05-'+Date.now()+'.json',JSON.stringify({at:new Date().toISOString(),results,metadataOnly:true},null,2),{flag:'wx'});
