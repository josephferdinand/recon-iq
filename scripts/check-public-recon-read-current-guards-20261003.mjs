// Read-only guard verification; consumes no business/token/vault rows from DB.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const vault=await readFile('./.private/CREDENTIALS.md','utf8');
const start=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),end=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');
if(start<0||end<=start)throw Error('Canonical credential section unavailable');
const token=vault.slice(start,end).split(/\r?\n/).find(x=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(x))?.split('|')[2]?.trim().replace(/^`|`$/g,'');
if(!/^sbp_[A-Za-z0-9_-]{20,}$/.test(token??''))throw Error('Management access unavailable');
const results=[];
for(const [environment,ref] of [['PROD','YOUR_PROJECT_REF'],['DEV','YOUR_PROJECT_REF']]){
 for(const suffix of ['current','dependency']){
  const path=`scripts/public-recon-read-${suffix}-guard-20261003.sql`,query=await readFile(path,'utf8');
  const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({read_only:true,query}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`${environment} read-only ${suffix} guard HTTP${response.status}; body withheld`);
  const rows=await response.json(),pass=suffix==='current'?rows?.[0]?.exact_preimage_matches:rows?.[0]?.exact_dependencies_match;
  const result={environment,ref,suffix,at:new Date().toISOString(),read_only:true,querySha256:createHash('sha256').update(query).digest('hex'),pass:pass===true,rows};results.push(result);console.log(JSON.stringify(result));
  if(pass!==true)throw Error('Actual preimage drift; recapture/requalify, never waive');
 }
}
const file='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/FVI-RECON-READ-CURRENT-GUARDS-20261003.json';
await writeFile(file,JSON.stringify(results,null,2));console.log(JSON.stringify({file,noBusinessRows:true}));
