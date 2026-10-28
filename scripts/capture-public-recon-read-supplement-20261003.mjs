// Curie — metadata capture only. No tokens/business rows, apply or credential output.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const query = await readFile(new URL('./public-recon-read-catalog-request-20261003.sql',import.meta.url),'utf8');
const vault=await readFile('./.private/CREDENTIALS.md','utf8');
const start=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),end=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');
if(start<0||end<=start)throw Error('Canonical credential section unavailable');
const token=vault.slice(start,end).split(/\r?\n/).find(x=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(x))?.split('|')[2]?.trim().replace(/^`|`$/g,'');
if(!/^sbp_[A-Za-z0-9_-]{20,}$/.test(token??''))throw Error('Management access unavailable');
for(const [environment,ref] of [['PROD','YOUR_PROJECT_REF'],['DEV','YOUR_PROJECT_REF']]){
 const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({read_only:true,query}),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(`${environment} read-only catalog HTTP${response.status}; body withheld`);
 const rows=await response.json();if(rows.length!==1||!rows[0].catalog)throw Error('Catalog envelope unavailable');
 const result={at:new Date().toISOString(),environment,ref,read_only:true,querySha256:createHash('sha256').update(query).digest('hex'),fingerprint:rows[0].metadata_fingerprint,...rows[0].catalog};
 if(result.ledger!==(environment==='PROD'?448:426)||result.latest!=='20261002133100')throw Error(`${environment} ledger drift; do not qualify`);
 const bytes=JSON.stringify(result,null,2),file=`./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/FVI-RECON-READ-SUPPLEMENT-${environment}-20261003.json`;
 await writeFile(file,bytes);console.log(JSON.stringify({environment,file,sha256:createHash('sha256').update(bytes).digest('hex'),at:result.at,ledger:result.ledger,latest:result.latest,relations:result.relations.length,columns:result.columns.length,helpers:result.helpers.length,fingerprint:result.fingerprint,noBusinessRowsCaptured:true}));
}
