import{readFile,writeFile}from'node:fs/promises';
import{createHash}from'node:crypto';
const root='output/recon-atomic-completion-next-20261005',privateRoot='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925',sha=x=>createHash('sha256').update(x).digest('hex');
const manifest=JSON.parse(await readFile(root+'/METADATA-FOLLOWUP.json','utf8'));
const vault=await readFile('./.private/CREDENTIALS.md','utf8'),a=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),b=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');if(a<0||b<=a)throw Error('FVI authority boundary');
const token=vault.slice(a,b).split(/\r?\n/).find(x=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(x))?.split('|')[2]?.trim().replace(/^`|`$/g,'');if(!/^sbp_/.test(token??''))throw Error('FVI token unavailable');
const results=[];
for(const [environment,ref,ledger]of[['PROD','YOUR_PROJECT_REF',459],['DEV','YOUR_PROJECT_REF',434]]){
 const packets=[];for(const entry of manifest.queries){const sql=await readFile(root+'/'+entry.file,'utf8');if(sha(sql)!==entry.sha256)throw Error('Approved metadata SELECT drift');const r=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({query:sql,read_only:true}),signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('Metadata followup HTTP'+r.status);packets.push({file:entry.file,sqlSHA256:entry.sha256,rows:await r.json()});}
 const payload=JSON.stringify({at:new Date().toISOString(),environment,ref,ledgerReference:ledger,latestReference:'20261005120000',packets,readOnly:true,noBusinessRows:true},null,2);
 const file=privateRoot+'/FVI-RECON-ATOMIC-FOLLOWUP-'+environment+'-'+Date.now()+'.json';await writeFile(file,payload,{flag:'wx'});results.push({environment,file,sha256:sha(payload),packets:packets.length,readOnly:true});console.log(JSON.stringify(results.at(-1)));
}
await writeFile(root+'/FOLLOWUP-CAPTURE-ACK.json',JSON.stringify({at:new Date().toISOString(),results,noSQLMutation:true},null,2),{flag:'wx'});
