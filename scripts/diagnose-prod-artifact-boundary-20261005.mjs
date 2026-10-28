import{readFile,readdir,writeFile}from'node:fs/promises';
import path from'node:path';
const base='./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928/dist';
const vault=await readFile('./.private/CREDENTIALS.md','utf8');
const a=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),b=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');if(a<0||b<=a)throw Error('Authority boundary');
const secret=vault.slice(a,b).split(/\r?\n/).find(x=>x.startsWith('| `SUPABASE_PROD_SERVICE_ROLE_KEY` |'))?.split('|')[2]?.trim().replace(/^`|`$/g,'');if(!secret)throw Error('Protected key unavailable');
const matches=[];
async function visit(relative=''){for(const f of await readdir(path.join(base,relative),{withFileTypes:true})){const next=path.join(relative,f.name);if(f.isDirectory())await visit(next);else if(f.isFile()){const bytes=await readFile(path.join(base,next));const prod=bytes.includes(Buffer.from('YOUR_PROJECT_REF')),dev=bytes.includes(Buffer.from('YOUR_PROJECT_REF')),service=bytes.includes(Buffer.from(secret));if(prod||dev||service)matches.push({path:next.replaceAll('\\','/'),prod,dev,service});}}}
await visit();
await writeFile('output/parent-integrated-next-20261005/home-reports/artifact-boundary-diagnostic'+(process.argv[2]==='repair02'?'-repair02':'')+'.json',JSON.stringify({at:new Date().toISOString(),matches,noSecretValues:true},null,2),{flag:'wx'});
console.log(JSON.stringify({prodFiles:matches.filter(x=>x.prod).length,serviceFiles:matches.filter(x=>x.service).map(x=>x.path),devFiles:matches.filter(x=>x.dev).map(x=>x.path)}));
