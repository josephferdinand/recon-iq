import{readFile,writeFile}from'node:fs/promises';
import{createHash}from'node:crypto';
const revision=process.argv[2]??'base';if(!['base','admin-v3','literal-v4'].includes(revision))throw Error('Explicit supported revision required');
const root='output/recovery-current-458-433-successor-20261005'+(revision==='admin-v3'?'/admin-gate-revision-03':revision==='literal-v4'?'/parent-literal-wrapper-v4':''),privateRoot='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925',sha=x=>createHash('sha256').update(x).digest('hex');
const manifest=JSON.parse(await readFile(root+'/qualified-manifest.json','utf8'));
const bodySHA256=manifest.bodySHA256??manifest.sourceBodySHA256;
const vault=await readFile('./.private/CREDENTIALS.md','utf8'),start=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),end=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');if(start<0||end<=start)throw Error('FVI authority boundary');
const token=vault.slice(start,end).split(/\r?\n/).find(x=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(x))?.split('|')[2]?.trim().replace(/^`|`$/g,'');if(!/^sbp_/.test(token??''))throw Error('FVI authority unavailable');
const refs={PROD:'YOUR_PROJECT_REF',DEV:'YOUR_PROJECT_REF'};
const identity="SELECT current_setting('server_version_num') AS engine,(SELECT count(*)::int FROM supabase_migrations.schema_migrations) AS ledger,(SELECT max(version::text) FROM supabase_migrations.schema_migrations) AS latest,to_regnamespace('rlnext') IS NULL AS namespace_absent,(SELECT count(*)::int FROM pg_proc WHERE proname LIKE 'rlnext_%') AS named_helpers";
async function query(ref,sql,readonly){const r=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({query:sql,read_only:readonly}),signal:AbortSignal.timeout(150000)});const raw=await r.text();if(!r.ok){const file=privateRoot+'/FVI-RECOVERY-SUCCESSOR-ROLLBACK-ERROR-'+Date.now()+'.json';await writeFile(file,JSON.stringify({at:new Date().toISOString(),ref,http:r.status,raw},null,2),{flag:'wx'});throw Error('Recovery successor rollback HTTP'+r.status+'; private diagnostic saved; no commit/replay');}return JSON.parse(raw);}
const results=[];
for(const plan of manifest.candidates){
 const ref=refs[plan.environment];if(!ref)throw Error('Unknown exact target');const sql=await readFile(root+'/'+plan.file,'utf8');if(sha(sql)!==plan.sha256||!/^BEGIN;/.test(sql)||!sql.trimEnd().endsWith('ROLLBACK;'))throw Error('Exact frozen rollback mismatch');
 const before=(await query(ref,identity,true))[0];const expectedLedger=plan.environment==='PROD'?458:433;if(before.engine!=='170006'||before.ledger!==(plan.ledger??expectedLedger)||before.latest!=='20261005080000'||!before.namespace_absent)throw Error('Actual current Recovery target/namespace drift');
 const base=privateRoot+'/FVI-RECOVERY-SUCCESSOR-'+plan.environment+'-ROLLBACK-'+Date.now();await writeFile(base+'-INTENT.json',JSON.stringify({at:new Date().toISOString(),ref,sourceSHA256:sha(sql),before,status:'submission_pending',committed:false},null,2),{flag:'wx'});
 const execution=await query(ref,sql,false),after=(await query(ref,identity,true))[0];if(JSON.stringify(after)!==JSON.stringify(before))throw Error('Rollback metadata identity drift; inspect without repeat');
 await writeFile(base+'-RECEIPT.json',JSON.stringify({at:new Date().toISOString(),environment:plan.environment,ref,sourceSHA256:sha(sql),bodySHA256,before,execution,after,rollbackPassed:true,committed:false,revision},null,2),{flag:'wx'});
 const result={environment:plan.environment,ref,ledger:after.ledger,sourceSHA256:sha(sql),rollbackPassed:true,committed:false,receipt:base+'-RECEIPT.json'};results.push(result);console.log(JSON.stringify(result));
}
await writeFile('docs/evidence/FVI_RECOVERY_SUCCESSOR_ROLLBACK_2026-10-05-'+Date.now()+'.json',JSON.stringify({at:new Date().toISOString(),results,bodySHA256,noSQLCommit:true,revision},null,2),{flag:'wx'});
