import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const query=await readFile(new URL('./public-recon-token-assurance-catalog-request-20261003.sql',import.meta.url),'utf8');
const vault=await readFile('./.private/CREDENTIALS.md','utf8');
const start=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),end=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');
if(start<0||end<=start)throw Error('Canonical credential section unavailable');
const token=vault.slice(start,end).split(/\r?\n/).find(x=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(x))?.split('|')[2]?.trim().replace(/^`|`$/g,'');
if(!/^sbp_[A-Za-z0-9_-]{20,}$/.test(token??''))throw Error('Management access unavailable');
for(const [environment,ref] of [['PROD','YOUR_PROJECT_REF'],['DEV','YOUR_PROJECT_REF']]){
 const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({read_only:true,query}),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(`${environment} read-only assurance metadata HTTP${response.status}; body withheld`);
 const rows=await response.json();if(rows.length!==1||!rows[0].catalog)throw Error('Catalog absent');
 const result={at:new Date().toISOString(),environment,ref,read_only:true,querySha256:createHash('sha256').update(query).digest('hex'),...rows[0].catalog};
 const configResponse=await fetch(`https://api.supabase.com/v1/projects/${ref}/config/postgrest`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
 if(configResponse.ok){const config=await configResponse.json();result.postgrestConfig={read_only:true,http:configResponse.status,db_pre_request:config.db_pre_request??null,verified:true};}
 else result.postgrestConfig={read_only:true,http:configResponse.status,verified:false,limitation:'Management config route unavailable; not evidence of absent pre-request enforcement'};
 if(result.ledger!==(environment==='PROD'?448:426)||result.latest!=='20261002133100')throw Error('Ledger drift');
 const bytes=JSON.stringify(result,null,2),file=`./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/FVI-RECON-TOKEN-ASSURANCE-${environment}-20261003.json`;
 await writeFile(file,bytes);console.log(JSON.stringify({environment,file,sha256:createHash('sha256').update(bytes).digest('hex'),at:result.at,ledger:result.ledger,relations:result.relations.map(r=>r.relname),helpers:result.helpers.map(h=>h.schema+'.'+h.name)}));
}
