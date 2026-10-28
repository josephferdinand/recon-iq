import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const root='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925';
const source=root+'/FVI-GODEL-BENCHMARK01-04-OWNED-QA-TRANSPORT-PROD7180321A-20261004.json';
const bytes=await readFile(source,'utf8'),sha=s=>createHash('sha256').update(s).digest('hex');
if(sha(bytes)!=='763605ddc8f69c79732935e36c3d52b12247aa37281d8377fe97133aef3a6289')throw Error('Qualified private transport source drift');
const config=JSON.parse(bytes),env=config.private_transport.environment;
if(config.deployment_id!=='7180321a-e9c5-4014-bd9b-a3f1c52e392b'||config.ledger_count!==451||config.latest_migration!=='20261003180000'||config.isolated_owned_qa_actors!==true)throw Error('Current owned transport identity mismatch');
if(config.actors.maker.user_id===config.actors.checker.user_id)throw Error('Independent actors required');
const key=env.FVI_BENCHMARK_PUBLISHABLE_KEY;if(!key?.startsWith('eyJ')||JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role!=='anon')throw Error('Ordinary public API key required');
const proofs=[];
for(const [kind,tokenName]of [['maker','FVI_BENCHMARK_MAKER_TOKEN'],['checker','FVI_BENCHMARK_CHECKER_TOKEN']]){
 const token=env[tokenName],claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
 if(claims.sub!==config.actors[kind].user_id||claims.aal!=='aal2'||claims.role!=='authenticated'||claims.iss!==config.supabase_origin+'/auth/v1'||!Number.isFinite(claims.exp)||claims.exp*1000-Date.now()<300000)throw Error('Fresh genuine owned actor/MFA claims required: '+kind);
 const headers={apikey:key,Authorization:`Bearer ${token}`};
 const u=await fetch(config.supabase_origin+'/auth/v1/user',{headers,signal:AbortSignal.timeout(15000)});const user=await u.json();if(!u.ok||user.id!==claims.sub)throw Error('Provider current actor verification failed: '+kind);
 const r=await fetch(config.supabase_origin+'/rest/v1/tenant_members?select=user_id,role,active,deactivated_at&tenant_id=eq.'+config.tenant_id+'&user_id=eq.'+claims.sub,{headers,signal:AbortSignal.timeout(15000)});const members=await r.json();if(!r.ok||!Array.isArray(members)||members.length!==1||members[0].active!==true||members[0].role!=='tenant_admin'||members[0].deactivated_at!==null)throw Error('Current active scoped QA admin required: '+kind);
 const b=await fetch(config.supabase_origin+'/rest/v1/business_units?select=id,tenant_id,is_archived&tenant_id=eq.'+config.tenant_id+'&id=eq.'+config.bu_id,{headers,signal:AbortSignal.timeout(15000)});const bu=await b.json();if(!b.ok||!Array.isArray(bu)||bu.length!==1||bu[0].is_archived!==false)throw Error('Actual active owned QA BU required: '+kind);
 proofs.push({kind,actor:claims.sub,tenant:config.tenant_id,bu:config.bu_id,role:'tenant_admin',aal:'aal2',providerUserVerified:true,currentActiveMembershipVerified:true,expiry:claims.exp});
}
config.parent_owned_qa_ack=true;config.bindings_7180321a_artifact_ack=true;config.bindings_5fbb_artifact_ack=false;
config.current_schema_capture={path:root+'/FVI-BENCHMARK-CURRENT-MANAGEMENT-OPENAPI-2026-10-03T21-55-28-950Z.json',sha256:'10eaca60045e3d8e9fc4e5466ae7cf4d6719be6154b8a4fe9a59956480c6bbf5',source:'official_readonly_management_openapi',ordinaryPermissionProof:false};
config.private_transport.parent_ack={at:new Date().toISOString(),standingOwnerAuthorization:true,proofs,sourcePath:source,sourceSha256:sha(bytes),noNewActorsOrRoleFactorCredentialChanges:true,metadataOnlyManagementCapture:true,allBenchmarkBusinessRequestsOrdinaryActors:true};
const output=root+'/FVI-GODEL-BENCHMARK01-04-PARENT-ACK-PROD7180321A-20261004-v2.json',data=JSON.stringify(config,null,2);await writeFile(output,data,{flag:'wx'});
console.log(JSON.stringify({output,sha256:sha(data),parentOwnedQaAck:true,release:config.deployment_id,ledger:451,realAal2Actors:2,earliestExpiry:Math.min(...proofs.map(p=>p.expiry)),businessWrites:0}));
