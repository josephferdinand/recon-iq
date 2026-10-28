import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {signIn,tenant,out,evidence,journal,rest,rpc} from './common.mjs';
const privateReceipt='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/FVI-ACCESS-CURRENT-SCOPE-PROD-20261004-v2-APPLY-RECEIPT.json';
const committed=JSON.parse(await readFile(privateReceipt,'utf8'));
if(committed.commitVerified!==true||committed.after.rows[0]?.ledger!==456||committed.after.rows[0]?.latest!=='20261004163000'||committed.sourceSha256!=='2da65a7a81743b64564df5d1165f48716ee9a4c082c50b367351ff0b81ccdb37')throw Error('Actual exact committed Access proof required');
const state=JSON.parse(await readFile(path.join(out,'OWNED.json'),'utf8')),owned=state.owned;
if(owned.revocation?.outcome!=='revoked'||!owned.pipeline)throw Error('Exact retained revoked owned fixture required');
const admin=await signIn('volta-recon-dataprep'),viewer=await signIn('kepler-scoped-observer');
if(!admin.tenantAdmin||admin.platformAdmin||viewer.tenantAdmin||viewer.platformAdmin)throw Error('Actual current pure tenant-admin/nonadmin roles changed');
const before=await rest(admin,'data_prep_pipelines',{select:'id,name,updated_at',tenant_id:'eq.'+tenant,id:'eq.'+owned.pipeline});
if(before.http!==200||before.data.length!==1)throw Error('Exact owned pipeline readback required');
const key='POST456-BACKEND-'+Date.now();
await journal({phase:'intent',key,operation:'bounded revoked owned pipeline edit refusal',args:{pipeline_id:owned.pipeline}});
const edit=await rpc(viewer,'upsert_data_prep_pipeline',{_tenant_id:tenant,_pipeline_id:owned.pipeline,_payload:{name:state.label+' post456 unauthorized negative attempt'}});
await journal({phase:'response-observed',key,http:edit.http,code:edit.data?.code,knownResponse:true});
const after=await rest(admin,'data_prep_pipelines',{select:'id,name,updated_at',tenant_id:'eq.'+tenant,id:'eq.'+owned.pipeline});
const permissions=await rpc(viewer,'effective_user_permissions',{_user_id:admin.id,_tenant_id:tenant});
const authority=await rpc(admin,'data_resource_shadow_allows',{_registry_id:owned.data_prep_pipelineRegistry,_action:'edit'});
const checks=[
 {name:'Actual ordinary revoked DataPrep edit refused',passed:edit.http===403&&edit.data?.code==='42501',http:edit.http,code:edit.data?.code},
 {name:'No owned pipeline row changed',passed:after.http===200&&JSON.stringify(before.data)===JSON.stringify(after.data)},
 {name:'Other-user permission disclosure closed',passed:permissions.http===200&&Array.isArray(permissions.data)&&permissions.data.length===0,http:permissions.http,count:permissions.data?.length},
 {name:'Existing pure tenant-admin mapped authority preserved',passed:authority.http===200&&authority.data===true},
];
const passed=checks.every(check=>check.passed);
await evidence(key+'.json',{at:new Date().toISOString(),target:'PROD YOUR_PROJECT_REF',schema456CommitVerified:true,ordinaryRealMfa:true,checks,passed,oldSetupApprovalRunRevocationReplayed:false,applicationInspectorAndGroupChecks:false,wholeAccessClosure:false});
console.log(JSON.stringify({passed,checks:checks.length,key,evidence:path.join(out,key+'.json')}));
if(!passed)process.exitCode=1;
