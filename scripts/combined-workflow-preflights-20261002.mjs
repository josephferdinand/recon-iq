import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const vaultRoot='E:/Falcon Group Projects/Cloud Data/Secured Key Vault',privateRoot='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925',candidate='./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928';
const vault=await readFile(vaultRoot+'/Falcon-Veritas-Keys.md','utf8'),a=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),b=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');if(a<0||b<=a)throw Error('Canonical credential markers absent');const token=vault.slice(a,b).split(/\r?\n/).find(x=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(x))?.split('|')[2]?.trim().replace(/^`|`$/g,'');if(!/^sbp_[A-Za-z0-9_-]{20,}$/.test(token??''))throw Error('Named management credential unavailable');
for(const [environment,ref]of [['PROD','YOUR_PROJECT_REF'],['DEV','YOUR_PROJECT_REF']]){
 for(const [label,file]of [
 ['reference',`${candidate}/output/playwright/reference-atomic-save-pg16-20261002/${environment}-reference-atomic-save-metadata-preflight.sql`],
 ['manual-eod',`${privateRoot}/BOYLE-${environment}-TASKS-METADATA-PREFLIGHT-20261002.sql`],
 ['exceptions',`${vaultRoot}/FVI-${environment}-LIFECYCLE-METADATA-PREFLIGHT-20261002.sql`],
 ]){
  const query=await readFile(file,'utf8');if(!query.includes('SELECT'))throw Error('Selected metadata query absent');
  const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({read_only:true,query}),signal:AbortSignal.timeout(45000)});
  if(!r.ok)throw Error(`${environment} ${label} preflightHTTP${r.status}; body withheld`);
  const rows=await r.json();
  const receipt={at:new Date().toISOString(),environment,ref,label,read_only:true,queryFile:file,query_sha256:createHash('sha256').update(query).digest('hex'),rows};
  const dest=`${privateRoot}/FVI-COMBINED-${environment}-${label.toUpperCase()}-PREFLIGHT-20261002.json`;await writeFile(dest,JSON.stringify(receipt,null,2));
  const booleans=[];
  function walk(v,key='',inChecks=false){if(typeof v==='boolean')booleans.push({key,value:v,inChecks});else if(Array.isArray(v))v.forEach(x=>walk(x,key,inChecks));else if(v&&typeof v==='object')for(const [k,x]of Object.entries(v))walk(x,k,inChecks||k==='checks');}
  walk(rows);
  const failures=booleans.filter(x=>x.inChecks?!x.value:x.key==='schema_drift'?x.value:['passed','ok','valid','qualified','read_only'].includes(x.key)?!x.value:true);
  if(!booleans.length)throw Error(`${environment} ${label} missing explicit boolean preflight evidence`);
  console.log(JSON.stringify({environment,label,http:r.status,rowCount:rows.length,booleanChecks:booleans.length,failedChecks:failures.length,receipt:dest}));
  if(failures.length)throw Error(`${environment} ${label} current preimage drift; inspect protected receipt, do not waive guards`);
 }
}
