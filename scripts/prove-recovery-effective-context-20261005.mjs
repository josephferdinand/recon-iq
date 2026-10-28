import{readFile,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';
const privateRoot='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925',sha=x=>createHash('sha256').update(x).digest('hex');
const sql=await readFile('output/recovery-current-458-433-successor-20261005/context-repair-revision-02/EFFECTIVE-NAMESPACE-IDENTITY.SELECT.sql','utf8');
if(!sql.trimEnd().endsWith('ROLLBACK;')||/\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE)\s+(?:TABLE|FUNCTION|SCHEMA|INTO|FROM|ON|TO)\b/i.test(sql))throw Error('Metadata/GUC-only context probe required');
const vault=await readFile('./.private/CREDENTIALS.md','utf8'),a=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),z=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');if(a<0||z<=a)throw Error('FVI credential boundary');const token=vault.slice(a,z).split(/\r?\n/).find(x=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(x))?.split('|')[2]?.trim().replace(/^`|`$/g,'');if(!/^sbp_/.test(token??''))throw Error('FVI authority unavailable');
const results=[];
for(const[environment,ref,ledger]of[['PROD','YOUR_PROJECT_REF',458],['DEV','YOUR_PROJECT_REF',433]]){
 const r=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({query:sql,read_only:false}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Metadata context probe HTTP'+r.status);
 const rows=await r.json(),proof=rows[0]?.recovery_effective_namespace_identity;
 const file=privateRoot+'/FVI-RECOVERY-EFFECTIVE-CONTEXT-'+environment+'-'+Date.now()+'.json';await writeFile(file,JSON.stringify({at:new Date().toISOString(),environment,ref,querySHA256:sha(sql),proof,noSQLCommitted:true},null,2),{flag:'wx'});
 if(proof?.engine!=='170006'||proof.ledger!==ledger||proof.latest!=='20261005080000'||!proof.captured_path_set_exact||!proof.ordered_namespace_identity_unchanged||!proof.effective_order_unchanged||!proof.implicit_order_unchanged||!proof.executor_unchanged||proof.schema_business_auth_changes!==false)throw Error('Exact context identity proof differs; private evidence retained');
 const result={environment,ref,ledger,querySHA256:sha(sql),effectiveOrderedNamespaceIdentical:true,executorIdentical:true,capturedSetterExact:true,file,sha256:sha(await readFile(file)),noSQLCommitted:true};results.push(result);console.log(JSON.stringify(result));
}
await writeFile('docs/evidence/FVI_RECOVERY_EFFECTIVE_CONTEXT_PROOF_2026-10-05-'+Date.now()+'.json',JSON.stringify({at:new Date().toISOString(),results},null,2),{flag:'wx'});
