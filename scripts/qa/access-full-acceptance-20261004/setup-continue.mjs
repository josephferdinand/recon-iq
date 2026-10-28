import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {signIn,tenant,out,journal,rest,rpc} from './common.mjs';
import {server} from './server.mjs';
const file=path.join(out,'OWNED.json'),state=JSON.parse(await readFile(file,'utf8'));
const save=()=>writeFile(file,JSON.stringify(state,null,2));
if(state.stage!=='BLOCKED_AT_EXACT_SETUP_STEP'||!state.error.startsWith('registerUpload refused:')||!state.owned.source||state.owned.upload)throw Error('Exact retained setup preimage required');
const admin=await signIn('volta-recon-dataprep');if(!admin.tenantAdmin||admin.platformAdmin)throw Error('Pure tenant-admin required');
async function call(name,args){await journal({phase:'intent',actor:admin.label,operation:name,args});const r=await server(admin,name,args);await journal({phase:'result',actor:admin.label,operation:name,...r});if(r.error||r.http>=400)throw Error(name+' refused: '+(r.error?.message??'HTTP'+r.http));return r.data;}
async function ordinary(name,args){await journal({phase:'intent',actor:admin.label,operation:name,args});const r=await rpc(admin,name,args);await journal({phase:'result',actor:admin.label,operation:name,...r});if(r.http>=400)throw Error(name+' refused: '+r.data.code+' '+r.data.message);return r.data;}
try{
 const uploads=await rest(admin,'workspace_data_source_uploads',{select:'id',tenant_id:'eq.'+tenant,data_source_id:'eq.'+state.owned.source});
 if(uploads.http!==200||uploads.data.length)throw Error('Upload already exists or readback uncertain; no repeat');
 const rows=[{ref:'EULER001',amount:'10.00'},{ref:'EULER002',amount:'20.00'}];
 const upload=await call('registerUpload',{tenant_id:tenant,data_source_id:state.owned.source,filename:'euler-access-'+state.run.slice(0,8)+'.csv',mime_type:'text/csv',size_bytes:54,row_count:2,columns:[{name:'ref',inferred_type:'string'},{name:'amount',inferred_type:'string'}],sample_rows:rows,rows});state.owned.upload=upload.id;await save();
 const recon=await call('upsertRecon',{tenant_id:tenant,name:state.label+' Recon',owner_bu_ids:[state.owned.bu],recon_type:'one_sided',sides:[{side_id:'A',label:'Owned synthetic input',data_source_id:state.owned.source,upload_id:state.owned.upload}],rules:[],status:'draft'});state.owned.recon=recon.id;await save();
 const pipeline=await call('upsertPipeline',{tenant_id:tenant,name:state.label+' Pipeline',source_data_source_id:state.owned.source,steps:[{kind:'trim',field:'ref'}],dq_rules:[],on_failure:'block',enabled:true});state.owned.pipeline=pipeline.id;await save();
 for(const [type,id] of [['data_source',state.owned.source],['data_prep_pipeline',state.owned.pipeline]]){
  const current=await rest(admin,'data_resource_registry',{select:'id',tenant_id:'eq.'+tenant,[type+'_id']:'eq.'+id});
  if(current.http!==200||!Array.isArray(current.data))throw Error('Registry readback unavailable');
  const registry=current.data[0]?.id??await ordinary('register_typed_data_resource',{_resource_type:type,_resource_id:id,_owner_bu_ids:[state.owned.bu],_reason:'Euler new owned access acceptance registry'});
  state.owned[type+'Registry']=registry;await save();
  for(const action of type==='data_source'?['view']:['view','run','edit'])await ordinary('grant_typed_data_resource_action',{_registry_id:registry,_bu_id:state.owned.bu,_principal_type:'group',_principal_id:state.owned.group,_action:action,_reason:'Euler new owned group action'});
 }
 for(const action of ['view','run','edit'])await ordinary('grant_recon_bu_action',{_recon_id:state.owned.recon,_bu_id:state.owned.bu,_principal_type:'group',_principal_id:state.owned.group,_action:action,_reason:'Euler new owned group action'});
 state.stage='READY_FOR_REQUEST_GRANT_REVOKE';delete state.error;
}catch(e){state.stage='BLOCKED_AT_CONTINUATION_STEP';state.error=e.message;process.exitCode=1;}
await save();console.log(JSON.stringify({stage:state.stage,owned:state.owned,error:state.error??null}));
