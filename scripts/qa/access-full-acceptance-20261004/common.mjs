import {readFile,mkdir,writeFile,appendFile} from 'node:fs/promises';
import {createHmac,createHash} from 'node:crypto';
import path from 'node:path';
export const privateRoot='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925';
export const out=path.resolve('output/access-full-acceptance-20261004');
export const tenant='aa5ed999-69eb-41a0-a9c6-fbb439efcffb';
export const host='https://app.reconiq.example';
export const load=async n=>JSON.parse(await readFile(path.join(privateRoot,n),'utf8'));
export const sha=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const transport=await load('FVI-QA-TRANSPORT-PROD-20261001.json');
const publicKey=transport.anonKey.startsWith('sb_publishable_')||(()=>{try{return JSON.parse(Buffer.from(transport.anonKey.split('.')[1],'base64url')).role==='anon';}catch{return false;}})();
if(transport.projectRef!=='YOUR_PROJECT_REF'||new URL(transport.apiUrl).hostname!=='YOUR_PROJECT_REF.supabase.co'||!publicKey)throw Error('PROD public transport boundary');
const claims=s=>JSON.parse(Buffer.from(s.access_token.split('.')[1],'base64url'));
function totp(secret){let bits='';for(const c of secret.toUpperCase().replaceAll('=','')){const n='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c);if(n<0)throw Error('Invalid protected MFA input');bits+=n.toString(2).padStart(5,'0');}const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));const ctr=Buffer.alloc(8);ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const h=createHmac('sha1',Buffer.from(bytes)).update(ctr).digest(),o=h[h.length-1]&15;return String((h.readUInt32BE(o)&0x7fffffff)%1000000).padStart(6,'0');}
async function auth(endpoint,body,token){const r=await fetch(transport.apiUrl+'/auth/v1/'+endpoint,{method:body?'POST':'GET',headers:{apikey:transport.anonKey,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});const data=await r.json();if(!r.ok)throw Error('Normal Auth '+endpoint.split('?')[0]+' HTTP'+r.status+' '+(data.error_code??data.code??'refused'));return data;}
export async function signIn(label){
 const seedFiles=['FVI-QA-FULL-PRODUCTION-ACTOR-SEEDS-20261001.json','FVI-QA-NONADMIN-ACTOR-SEEDS-20261001.json','FVI-QA-PLATFORM-ACTOR-SEEDS-20261001.json'];
 const seeds=(await Promise.all(seedFiles.map(load))).flatMap(x=>x.actors);
 const seed=seeds.find(x=>x.label===label);if(!seed)throw Error('Exact owned QA actor missing');
 const mfa=await load('FVI-QA-MFA-'+label+'-20261001.json');
 if(mfa.user_id!==seed.user_id||mfa.project_ref!==transport.projectRef||mfa.tenant_id!==tenant)throw Error('Real MFA mapping mismatch');
 const login=await auth('token?grant_type=password',{email:seed.email,password:seed.password});
 const challenge=await auth('factors/'+mfa.factor_id+'/challenge',{},login.access_token);
 const session=await auth('factors/'+mfa.factor_id+'/verify',{challenge_id:challenge.id,code:totp(mfa.totp_secret)},login.access_token);
 const c=claims(session);const user=await auth('user',null,session.access_token);
 if(c.sub!==seed.user_id||c.aal!=='aal2'||user.id!==seed.user_id)throw Error('Provider identity/AAL2 mismatch');
 const actor={label,id:seed.user_id,session,claims:c};
 const member=await rest(actor,'tenant_members',{select:'role,active',tenant_id:'eq.'+tenant,user_id:'eq.'+actor.id});
 const plat=await rpc(actor,'is_platform_admin',{_user_id:actor.id});
 const admin=await rpc(actor,'has_tenant_role',{_user_id:actor.id,_tenant_id:tenant,_role:'tenant_admin'});
 if(member.http!==200||plat.http!==200||admin.http!==200)throw Error('Authoritative current role read failed');
 actor.role=member.data;actor.platformAdmin=plat.data===true;actor.tenantAdmin=admin.data===true;
 return actor;
}
export async function rest(actor,table,params={},method='GET',body){
 if(!/^[a-z_]+$/.test(table))throw Error('Named public application table only');
 const started=Date.now();
 const r=await fetch(transport.apiUrl+'/rest/v1/'+table+'?'+new URLSearchParams(params),{method,headers:{apikey:transport.anonKey,Authorization:'Bearer '+actor.session.access_token,'Content-Type':'application/json',Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
 return {http:r.status,data:await r.json(),ms:Date.now()-started};
}
export async function rpc(actor,name,args){
 if(!/^[a-z_]+$/.test(name))throw Error('Named public application RPC only');
 const started=Date.now();const r=await fetch(transport.apiUrl+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:transport.anonKey,Authorization:'Bearer '+actor.session.access_token,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(20000)});
 return {http:r.status,data:await r.json(),ms:Date.now()-started};
}
export const actorProof=a=>({label:a.label,id:a.id,aal:a.claims.aal,expires:a.claims.exp,tenantRole:a.role,tenantAdmin:a.tenantAdmin,platformAdmin:a.platformAdmin});
export async function evidence(name,value){await mkdir(out,{recursive:true});await writeFile(path.join(out,name),JSON.stringify(value,null,2),{flag:'wx'});}
export async function journal(value){await mkdir(out,{recursive:true});await appendFile(path.join(out,'JOURNAL.jsonl'),JSON.stringify({at:new Date().toISOString(),...value})+'\n');}
export async function appReadback(){const r=await fetch(host+'/auth',{signal:AbortSignal.timeout(20000)}),html=await r.text();const assets=[...new Set(html.match(/\/assets\/styles-[A-Za-z0-9_-]+\.css/g)??[])];const styles=[];for(const asset of assets){const r=await fetch(host+asset,{signal:AbortSignal.timeout(20000)});styles.push({asset,http:r.status,sha:sha(Buffer.from(await r.arrayBuffer()).toString('base64'))});}return {http:r.status,styles,parentDeployment:'f52 (owner supplied; not provider reverified)',parentSchema:455};}
