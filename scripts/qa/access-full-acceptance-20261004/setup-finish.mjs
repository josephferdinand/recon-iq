import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {signIn,tenant,out,journal,rpc} from './common.mjs';
const file=path.join(out,'OWNED.json'),s=JSON.parse(await readFile(file,'utf8'));
if(s.stage!=='BLOCKED_AT_CONTINUATION_STEP'||s.error!=='Registry readback unavailable'||!s.owned.pipeline||s.owned.data_sourceRegistry)throw Error('Exact continuation state differs; no replay');
const logs=(await readFile(path.join(out,'JOURNAL.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
if(logs.some(x=>x.operation==='register_typed_data_resource'))throw Error('Registration previously submitted; uncertain outcome must be read back');
const a=await signIn('volta-recon-dataprep');if(!a.tenantAdmin||a.platformAdmin)throw Error('Pure tenant-admin required');
const save=()=>writeFile(file,JSON.stringify(s,null,2));
async function call(name,args){await journal({phase:'intent',actor:a.label,operation:name,args});const r=await rpc(a,name,args);await journal({phase:'result',actor:a.label,operation:name,...r});if(r.http>=400)throw Error(name+' refused: '+r.data.code+' '+r.data.message);return r.data;}
try{
 s.owned.registryGrants=[];s.owned.reconGrants=[];
 for(const [type,id] of [['data_source',s.owned.source],['data_prep_pipeline',s.owned.pipeline]]){
  // No registration was sent earlier; register these exact new roots once via the public purpose RPC.
  const registry=await call('register_typed_data_resource',{_resource_type:type,_resource_id:id,_owner_bu_ids:[s.owned.bu],_reason:'Euler new owned access acceptance registry'});
  s.owned[type+'Registry']=registry;await save();
  for(const action of type==='data_source'?['view']:['view','run','edit']){const grant=await call('grant_typed_data_resource_action',{_registry_id:registry,_bu_id:s.owned.bu,_principal_type:'group',_principal_id:s.owned.group,_action:action,_reason:'Euler new owned group action'});s.owned.registryGrants.push({type,action,id:grant});await save();}
 }
 for(const action of ['view','run','edit']){const grant=await call('grant_recon_bu_action',{_recon_id:s.owned.recon,_bu_id:s.owned.bu,_principal_type:'group',_principal_id:s.owned.group,_action:action,_reason:'Euler new owned group action'});s.owned.reconGrants.push({action,id:grant});await save();}
 s.stage='READY_FOR_REQUEST_GRANT_REVOKE';delete s.error;
}catch(e){s.stage='BLOCKED_AT_REGISTRATION_OR_GRANT';s.error=e.message;process.exitCode=1;}
await save();console.log(JSON.stringify({stage:s.stage,owned:s.owned,error:s.error??null}));
