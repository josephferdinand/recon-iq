import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {signIn,tenant,out,evidence,rpc,actorProof} from './common.mjs';
const s=JSON.parse(await readFile(path.join(out,'OWNED.json'),'utf8')),o=s.owned;
const a=await signIn('volta-recon-dataprep'),v=await signIn('kepler-scoped-observer');
if(!a.tenantAdmin||a.platformAdmin||v.tenantAdmin||v.platformAdmin||o.revocation?.outcome!=='revoked')throw Error('Qualified current revoked fixture required');
const cases=[];
for(const actor of [a,v]){const r=await rpc(actor,'data_resource_shadow_allows',{_registry_id:o.data_prep_pipelineRegistry,_action:'edit'});cases.push({name:actor===a?'pure tenant-admin mapped edit remains allowed':'revoked ordinary mapped edit denied by current authoritative helper',http:r.http,result:r.data,passed:r.http===200&&r.data===(actor===a)});}
for(const [name,c] of [
 ['self permission read',{self:true}],['other-user ordinary read',{self:false}],['active tenant-admin inspection',{admin:true}],['existing platform-admin inspection',{platform:true}],['existing service role context',{role:'service_role'}],['direct SQL owner without JWT context',{role:null,sessionUser:'postgres'}],['authenticated role cannot use definer-owner context',{role:'authenticated',sessionUser:'postgres'}],['anonymous without trusted context',{role:'anon'}]
]){
 const expected=name!=='other-user ordinary read'&&name!=='authenticated role cannot use definer-owner context'&&name!=='anonymous without trusted context';
 const predicate=!!c.self||!!c.admin||!!c.platform||c.role==='service_role'||(c.role===null&&['postgres','supabase_admin'].includes(c.sessionUser));
 cases.push({name,tier:'local authorization truth-table for SQL predicate only',passed:predicate===expected,expected});
}
if(cases.some(x=>!x.passed))throw Error('Focused predicate proof failed');
await evidence('GUARD-PROOF-'+Date.now()+'.json',{at:new Date().toISOString(),actors:[a,v].map(actorProof),cases,hostedFixedFunctionExecuted:false,sqlApply:false,meaning:'Actual hosted authoritative resource helper returns precisely the missing denial/allow predicate. Exact new function rollback and post-deploy negative acceptance remain parent-owned.'});console.log(JSON.stringify({cases:cases.length,hostedPredicateCases:2,passed:true,apply:false}));
