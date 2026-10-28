import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {signIn,actorProof,tenant,out,evidence,journal,rest,rpc} from './common.mjs';
import {server} from './server.mjs';
const file=path.join(out,'OWNED.json');
try{await readFile(file);throw Error('Existing owned run: read back and use bounded continuation; no setup replay');}catch(e){if(e.code!=='ENOENT')throw e;}
const run=randomUUID(),tag=run.slice(0,8),label='Euler Access '+tag;
const state={at:new Date().toISOString(),run,tenant,label,actors:[],owned:{},checks:[],stage:'setup'};
await evidence('OWNED.json',state);
const save=()=>writeFile(file,JSON.stringify(state,null,2));
const admin=await signIn('volta-recon-dataprep'),requester=await signIn('kepler-scoped-observer'),nonmember=await signIn('nonadmin-analyst');
state.actors=[admin,requester,nonmember].map(actorProof);
if(!admin.tenantAdmin||admin.platformAdmin||requester.tenantAdmin||requester.platformAdmin||nonmember.tenantAdmin||nonmember.platformAdmin)throw Error('Exact least-role actor contracts differ');
async function call(a,name,args,allowError=false){await journal({phase:'intent',actor:a.label,operation:name,args});const r=await server(a,name,args);await journal({phase:'result',actor:a.label,operation:name,...r});state.checks.push({name,actor:a.label,http:r.http,error:r.error,result:r.data});await save();if((r.error||r.http>=400)&&!allowError)throw Error(name+' refused: '+(r.error?.message??'HTTP'+r.http));return r;}
async function ordinary(a,name,args){await journal({phase:'intent',actor:a.label,operation:name,args});const r=await rpc(a,name,args);await journal({phase:'result',actor:a.label,operation:name,...r});if(r.http>=400)throw Error(name+' refused: '+r.data.code+' '+r.data.message);return r.data;}
try{
 // Hash old tenant roles before introducing only new owned access records.
 state.oldTenantRoles=await rest(admin,'tenant_members',{select:'tenant_id,user_id,role,active',tenant_id:'eq.'+tenant});
 const bu=await call(admin,'createBusinessUnit',{tenant_id:tenant,name:label+' BU',code:'EQA-'+tag});state.owned.bu=bu.data.id;await save();
 const group=await call(admin,'createGroup',{tenant_id:tenant,name:label+' Group',description:'New owned access QA only',bu_id:state.owned.bu});state.owned.group=group.data.id;await save();
 const ws=await call(admin,'upsertWorkspace',{tenantId:tenant,name:label+' Workspace',slug:'euler-access-'+tag,businessUnitId:state.owned.bu,description:'New owned access QA only',status:'active'});state.owned.workspace=ws.data.id;await save();
 const role=await call(admin,'createCustomRole',{tenant_id:tenant,name:label+' scoped role',permission_ids:['audit.log.read','audit.log.export','data.prep.read','data.prep.author']});state.owned.role=role.data.id;await save();
 await call(admin,'setGroupRoles',{tenant_id:tenant,group_id:state.owned.group,role_ids:[state.owned.role]});
 await call(admin,'assignBuGroup',{tenant_id:tenant,bu_id:state.owned.bu,group_id:state.owned.group,role:'bu_member',inherit_descendants:false});
 await call(admin,'assignBuUser',{tenant_id:tenant,bu_id:state.owned.bu,user_id:requester.id,role:'bu_member',inherit_descendants:false});
 const memberBody={tenant_id:tenant,workspace_id:state.owned.workspace,user_id:requester.id,role:'member',added_by:admin.id};
 await journal({phase:'intent',actor:admin.label,operation:'NEW owned workspace membership',args:memberBody});
 const membership=await rest(admin,'workspace_members',{},'POST',memberBody);await journal({phase:'result',operation:'NEW owned workspace membership',...membership});if(membership.http>=400)throw Error('New workspace member refused '+membership.data.code);
 state.owned.workspaceMembership=membership.data[0]?.id??memberBody;await save();
 for(const name of ['createBusinessUnit','createGroup','upsertWorkspace']){
  const args=name==='createBusinessUnit'?{tenant_id:tenant,name:label+' DENIED BU'}:name==='createGroup'?{tenant_id:tenant,name:label+' DENIED Group',bu_id:state.owned.bu}:{tenantId:tenant,name:label+' DENIED Workspace',slug:'euler-denied-'+tag,businessUnitId:state.owned.bu,status:'active'};
  const r=await call(nonmember,name,args,true);state.checks.push({name:'ordinary '+name+' denial',passed:!!r.error||r.http>=400});
  if(!r.error&&r.http<400)state.owned['unexpected-'+name]=r.data;
 }
 const source=await call(admin,'createDataSource',{tenant_id:tenant,name:label+' Source',source_type:'csv',description:'Two synthetic QA rows only'});state.owned.source=source.data.id;await save();
 const rows=[{ref:'EULER001',amount:'10.00'},{ref:'EULER002',amount:'20.00'}];
 const upload=await call(admin,'registerUpload',{tenant_id:tenant,data_source_id:state.owned.source,filename:'euler-access-'+tag+'.csv',mime_type:'text/csv',size_bytes:54,row_count:2,columns:[{name:'ref',inferred_type:'string'},{name:'amount',inferred_type:'string'}],sample_rows:rows,rows});state.owned.upload=upload.data.id;await save();
 const recon=await call(admin,'upsertRecon',{tenant_id:tenant,name:label+' Recon',owner_bu_ids:[state.owned.bu],recon_type:'one_sided',sides:[{side_id:'A',label:'Owned synthetic input',data_source_id:state.owned.source,upload_id:state.owned.upload}],rules:[],status:'draft'});state.owned.recon=recon.data.id;await save();
 const pipeline=await call(admin,'upsertPipeline',{tenant_id:tenant,name:label+' Pipeline',source_data_source_id:state.owned.source,steps:[{kind:'trim',field:'ref'}],dq_rules:[],on_failure:'block',enabled:true});state.owned.pipeline=pipeline.data.id;await save();
 for(const [type,id] of [['data_source',state.owned.source],['data_prep_pipeline',state.owned.pipeline]]){
  const current=await rest(admin,'data_resource_registry',{select:'id',tenant_id:'eq.'+tenant,[type+'_id']:'eq.'+id});
  const registry=current.data?.[0]?.id??await ordinary(admin,'register_typed_data_resource',{_resource_type:type,_resource_id:id,_owner_bu_ids:[state.owned.bu],_reason:'Euler new owned access acceptance registry'});
  state.owned[type+'Registry']=registry;await save();
  for(const action of type==='data_source'?['view']:['view','run','edit'])await ordinary(admin,'grant_typed_data_resource_action',{_registry_id:registry,_bu_id:state.owned.bu,_principal_type:'group',_principal_id:state.owned.group,_action:action,_reason:'Euler new owned group action'});
 }
 for(const action of ['view','run','edit'])await ordinary(admin,'grant_recon_bu_action',{_recon_id:state.owned.recon,_bu_id:state.owned.bu,_principal_type:'group',_principal_id:state.owned.group,_action:action,_reason:'Euler new owned group action'});
 state.stage='READY_FOR_REQUEST_GRANT_REVOKE';
}catch(e){state.stage='BLOCKED_AT_EXACT_SETUP_STEP';state.error=e.message;process.exitCode=1;}
await save();console.log(JSON.stringify({stage:state.stage,owned:state.owned,error:state.error??null}));
