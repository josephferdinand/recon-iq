import {readFile,writeFile,access} from 'node:fs/promises';
const vault=await readFile('./.private/CREDENTIALS.md','utf8');
const start=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),end=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');
if(start<0||end<=start)throw new Error('FVI vault boundary required');
const section=vault.slice(start,end);
function value(key){const lines=vault.split(/\r?\n/).filter(line=>line.startsWith('|')&&line.split('|')[1]?.trim().replace(/^[`*]+|[`*]+$/g,'')===key);if(lines.length!==1)throw new Error('One named FVI Cloudflare authority required');const selected=lines[0].split('|')[2]?.trim().replace(/^`|`$/g,'').replace(/^<|>$/g,'');if(!selected||! /^[A-Za-z0-9_-]+$/.test(selected))throw new Error('Named FVI authority unavailable');return selected;}
const cf=value('CLOUDFLARE_API_TOKEN');
const account='YOUR_CLOUDFLARE_ID';
if(value('CLOUDFLARE_ACCOUNT_ID')!==account)throw new Error('Owner account identity changed');
const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/fvi-app`,{headers:{authorization:`Bearer ${cf}`},signal:AbortSignal.timeout(25000)});
const result=await response.json();
if(!response.ok||!result.success||result.result.name!=='fvi-app')throw new Error('Actual FVI Pages resource unconfirmed');
const project=result.result;
const receipt={at:new Date().toISOString(),account,project:project.name,canonicalDeployment:project.canonical_deployment?.id,productionBranch:project.production_branch,services:project.deployment_configs?.production?.services,secretNames:Object.entries(project.deployment_configs?.production?.env_vars??{}).filter(([,v])=>v.type==='secret_text').map(([k])=>k).sort(),noSecretValuesIncluded:true};
if(receipt.productionBranch!=='main')throw new Error('Actual production branch differs');
if(process.argv[2]&&receipt.canonicalDeployment!==process.argv[2])throw new Error('Current production deployment changed; inspect before upload');
let outputRoot='./LOCAL_USER/AppData/Local/Temp/fvi-codex-docs-release-20260930/audit';
try{await access(outputRoot);}catch{outputRoot='./LOCAL_USER/OneDrive - 8gsp1y/Documents/ChatGPT/ReconIQ/docs/evidence';}
const file=outputRoot+'/core-group1-resource-'+Date.now()+'.json';
await writeFile(file,JSON.stringify(receipt,null,2),{flag:'wx'});
console.log(JSON.stringify({at:receipt.at,project:receipt.project,canonicalDeployment:receipt.canonicalDeployment,productionBranch:receipt.productionBranch,receipt:file}));
