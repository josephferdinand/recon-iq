import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const ROOT=process.cwd();
export const OUT=path.join(ROOT,'docs/evidence/FVI_STATUS_MONITOR_RELEASE_2026-10-25');
export const ACCOUNT='YOUR_CLOUDFLARE_ID';
export const PROJECTS={production:{ref:'YOUR_PROJECT_REF',app:'https://app.reconiq.example'},development:{ref:'YOUR_PROJECT_REF',app:'https://dev.app.reconiq.example'}};
export const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
export function credentials(){
 const primary='./.private/CREDENTIALS.md';
 const fallback='./.private/CREDENTIALS.md';
 const text=fs.readFileSync(fs.existsSync(primary)?primary:fallback,'utf8');
 const a=text.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),b=text.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');
 if(a<0||b<=a)throw Error('FVI credential boundary unavailable');
 const result={};for(const line of text.slice(a,b).split(/\r?\n/)){if(!line.startsWith('|'))continue;const fields=line.split('|');const name=fields[1]?.trim().replaceAll('`','');if(!name)continue;result[name]=fields[2]?.trim().replace(/^`|`$/g,'').replace(/^<|>$/g,'');}
 // These two CF fields are owner-maintained elsewhere in this FVI-only vault,
 // as used by the existing fvi-cloudflare.mjs wrapper. Read only exact names.
 for(const key of ['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN']){
  const rows=text.split(/\r?\n/).filter(line=>line.startsWith('|')&&line.split('|')[1]?.trim().replace(/^[`*]+|[`*]+$/g,'')===key);
  if(rows.length!==1)throw Error('FVI Cloudflare field identity ambiguous');
  result[key]=rows[0].split('|')[2]?.trim().replace(/^`|`$/g,'').replace(/^<|>$/g,'');
 }
 if(result.CLOUDFLARE_ACCOUNT_ID&&result.CLOUDFLARE_ACCOUNT_ID!==ACCOUNT)throw Error('FVI account identity mismatch');
 if(!result.CLOUDFLARE_API_TOKEN||!result.SUPABASE_ACCESS_TOKEN)throw Error('Required existing FVI management access unavailable');
 return result;
}
export async function api(url,token,options={}){
 const response=await fetch(url,{...options,headers:{authorization:'Bearer '+token,...options.headers},signal:AbortSignal.timeout(20000)});
 const raw=await response.text();let value;try{value=JSON.parse(raw);}catch{value=null;}
 if(!response.ok||value?.success===false){const error=Error('Owned provider request refused');error.status=response.status;error.codes=value?.errors?.map(x=>x.code)??[];throw error;}
 return value?.result??value;
}
export const cf=(suffix,keys,options)=>api('https://api.cloudflare.com/client/v4'+suffix,keys.CLOUDFLARE_API_TOKEN,options);
export const sb=(suffix,keys,options)=>api('https://api.supabase.com/v1'+suffix,keys.SUPABASE_ACCESS_TOKEN,options);
export function save(name,value){fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,name),JSON.stringify(value,null,2));}
async function publicCheck(url,headers={}){const start=Date.now();try{const r=await fetch(url,{headers,redirect:'manual',signal:AbortSignal.timeout(10000)});const raw=await r.text();let v;try{v=JSON.parse(raw);}catch{v=null;}return{http:r.status,latency_ms:Date.now()-start,json_array:Array.isArray(v),array_rows:Array.isArray(v)?v.length:null,service_name:v?.name??null,has_snapshot:v&&typeof v==='object'&&Array.isArray(v.health),html:raw.includes('<html'),body_retained:false};}catch{return{http:null,latency_ms:Date.now()-start,error:'Request did not complete; no raw diagnostics retained'};}}
export async function projectKeys(keys){const result={};for(const[env,p]of Object.entries(PROJECTS)){const records=await sb('/projects/'+p.ref+'/api-keys',keys);if(!Array.isArray(records))throw Error('Project key metadata unavailable');const anon=records.find(x=>x.name==='anon')??records.find(x=>x.type==='publishable');if(!anon?.api_key)throw Error('Existing public API key unavailable');result[env]=anon.api_key;}return result;}
export async function preflight(){
 const keys=credentials();const account=await cf('/accounts/'+ACCOUNT,keys);if(account.id!==ACCOUNT)throw Error('Wrong account');
 const workers=await cf('/accounts/'+ACCOUNT+'/workers/scripts',keys);
 const namespaces=await cf('/accounts/'+ACCOUNT+'/storage/kv/namespaces?per_page=100',keys);
 const domains=await cf('/accounts/'+ACCOUNT+'/workers/domains',keys);
 const zones=await cf('/zones?name=reconiq.example',keys);
 const anon=await projectKeys(keys);const projects={};
 for(const[environment,p]of Object.entries(PROJECTS)){
  const state=await sb('/projects/'+p.ref,keys);
  const h={apikey:anon[environment],authorization:'Bearer '+anon[environment]};
  const checks=await Promise.all([
   publicCheck(p.app+'/auth'),publicCheck(p.app+'/api/public/status.json'),
   publicCheck('https://'+p.ref+'.supabase.co/auth/v1/health',h),
   publicCheck('https://'+p.ref+'.supabase.co/rest/v1/status_components?select=key,name&limit=100',h),
   publicCheck('https://'+p.ref+'.supabase.co/storage/v1/status',h),
   publicCheck('https://'+p.ref+'.supabase.co/rest/v1/rpc/status_public_snapshot',{...h,'content-type':'application/json'})]);
  projects[environment]={ref:p.ref,status:state.status,region:state.region,checks:{application:checks[0],published_status:checks[1],auth:checks[2],database_read:checks[3],storage:checks[4],published_snapshot:checks[5]}};
 }
 const value={utc:new Date().toISOString(),account_verified:true,workers:workers.filter(x=>/fvi.*status|status.*fvi|veritas.*status/i.test(x.id)).map(x=>({id:x.id,modified_on:x.modified_on})),namespaces:namespaces.filter(x=>/fvi.*status|status.*fvi/i.test(x.title)),status_domains:domains.filter(x=>x.hostname==='status.reconiq.example'),zone:zones.map(x=>({id:x.id,name:x.name})),projects,provider_writes:0};
 save('PREFLIGHT.json',value);console.log(JSON.stringify(value));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(process.argv[2]==='preflight')await preflight();}
