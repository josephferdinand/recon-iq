import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const vault=await readFile('./.private/CREDENTIALS.md','utf8');
const begin=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),end=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');
if(begin<0||end<=begin)throw Error('Canonical vault markers unavailable');
const token=vault.slice(begin,end).split(/\r?\n/).find(x=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(x))?.split('|')[2]?.trim().replace(/^`|`$/g,'');
if(!/^sbp_[A-Za-z0-9_-]{20,}$/.test(token??''))throw Error('Management access unavailable');
const query=await readFile('./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928/scripts/boyle-current-catalog-readonly-20261002.sql','utf8');
if(!query.startsWith('-- Parent executes with read_only=true')||!query.includes('AS catalog;'))throw Error('Unexpected metadata query');
for(const [env,ref] of [['PROD','YOUR_PROJECT_REF'],['DEV','YOUR_PROJECT_REF']]){
 const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({read_only:true,query}),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(`${env} metadata HTTP${response.status}, body withheld`);
 const rows=await response.json();if(!Array.isArray(rows)||!rows[0]?.catalog)throw Error('Metadata result shape unavailable');
 const file=`./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/BOYLE-TASKS-EOD-QUALIFICATION-RETURN-20261002/PARENT-CURRENT-${env}-20261002.json`;
 const bytes=JSON.stringify({at:new Date().toISOString(),ref,read_only:true,query_sha256:createHash('sha256').update(query).digest('hex'),rows},null,2);await writeFile(file,bytes);
 console.log(JSON.stringify({environment:env,http:response.status,file,sha256:createHash('sha256').update(bytes).digest('hex'),ledger:rows[0].catalog.ledger,permissionCount:rows[0].catalog.permissions.length}));
}
