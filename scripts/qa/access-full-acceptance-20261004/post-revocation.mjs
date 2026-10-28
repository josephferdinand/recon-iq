import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {signIn,actorProof,tenant,out,evidence,journal,rest,rpc} from './common.mjs';
import {server} from './server.mjs';
const s=JSON.parse(await readFile(path.join(out,'OWNED.json'),'utf8')),o=s.owned;
if(o.revocation?.outcome!=='revoked')throw Error('Exact owned membership must already be revoked');
const admin=await signIn('volta-recon-dataprep'),viewer=await signIn('kepler-scoped-observer');
if(!admin.tenantAdmin||admin.platformAdmin||viewer.tenantAdmin||viewer.platformAdmin)throw Error('Least-role actor contract changed');
const proof={at:new Date().toISOString(),run:s.run,actors:[admin,viewer].map(actorProof),checks:[],noApprovalOrRunReplay:true};
const check=(name,pass,details)=>proof.checks.push({name,pass,details});
async function counts(){const runs=await rest(admin,'recon_runs',{select:'id',tenant_id:'eq.'+tenant,definition_id:'eq.'+o.recon}),dp=await rest(admin,'data_prep_runs',{select:'id',tenant_id:'eq.'+tenant,pipeline_id:'eq.'+o.pipeline});if(runs.http!==200||dp.http!==200)throw Error('Actual owned run readback unavailable');return {recon:runs.data.map(x=>x.id),dataPrep:dp.data.map(x=>x.id)};}
const before=await counts();
const def=await rest(admin,'recon_definitions',{select:'sides,rules,recon_type',id:'eq.'+o.recon,tenant_id:'eq.'+tenant});
const actions=[
 ['runReconDefinition',{tenant_id:tenant,id:o.recon}],
 ['runCorrelatedDataPrepPipeline',{tenant_id:tenant,pipeline_id:o.pipeline,request_key:randomUUID()}],
 ['upsertRecon',{tenant_id:tenant,id:o.recon,name:s.label+' revoked edit must fail',...def.data[0]}],
 ['upsertPipeline',{tenant_id:tenant,id:o.pipeline,name:s.label+' revoked edit must fail',source_data_source_id:o.source,steps:[{kind:'trim',field:'ref'}],dq_rules:[],on_failure:'block',enabled:true}],
 ['setGroupRoles',{tenant_id:tenant,group_id:o.group,role_ids:[o.role]}]
];
for(const [name,args] of actions){await journal({phase:'intent',actor:viewer.label,operation:'post-revocation '+name,args});const r=await server(viewer,name,args);await journal({phase:'result',actor:viewer.label,operation:'post-revocation '+name,...r});check('revoked ordinary '+name+' refused',!!r.error||r.http>=400,{http:r.http,error:r.error,data:r.error?undefined:r.data});}
const after=await counts();check('revoked actual run calls created zero owned runs',JSON.stringify(before)===JSON.stringify(after),{before,after});
const wmBefore=await rest(admin,'workspace_members',{select:'id,role,user_id',workspace_id:'eq.'+o.workspace,user_id:'eq.'+viewer.id,tenant_id:'eq.'+tenant});
const selfPromotion=await rest(viewer,'workspace_members',{workspace_id:'eq.'+o.workspace,user_id:'eq.'+viewer.id,tenant_id:'eq.'+tenant},'PATCH',{role:'admin'});
const wmAfter=await rest(admin,'workspace_members',{select:'id,role,user_id',workspace_id:'eq.'+o.workspace,user_id:'eq.'+viewer.id,tenant_id:'eq.'+tenant});
check('ordinary workspace member cannot promote own new membership',JSON.stringify(wmBefore.data)===JSON.stringify(wmAfter.data)&&wmAfter.data[0]?.role==='member',{attemptHttp:selfPromotion.http,attemptCode:selfPromotion.data?.code,before:wmBefore.data,after:wmAfter.data});
if(wmAfter.data[0]?.role!=='member'){
 // The only possible repair is the exact new membership created by this lane.
 const repair=await rest(admin,'workspace_members',{id:'eq.'+wmBefore.data[0].id,workspace_id:'eq.'+o.workspace,user_id:'eq.'+viewer.id,tenant_id:'eq.'+tenant},'PATCH',{role:'member'});proof.ownedRoleRepair={http:repair.http};
}
const inspect=await server(viewer,'explainUserAccess',{tenant_id:tenant,user_id:admin.id},{source:'src/lib/access.functions.ts'});check('ordinary user cannot inspect another QA user through Access Explorer',!!inspect.error||inspect.http>=400,{http:inspect.http,error:inspect.error});
const userPermissionRead=await server(viewer,'effectivePermissions',{tenant_id:tenant,user_id:admin.id});proof.groupPermissionInspection={http:userPermissionRead.http,error:userPermissionRead.error,returnedPermissionCount:Array.isArray(userPermissionRead.data)?userPermissionRead.data.length:null};check('group inspector does not disclose another QA user permissions',!!userPermissionRead.error||userPermissionRead.http>=400||userPermissionRead.data?.length===0,proof.groupPermissionInspection);
const revokeAudit=o.revocation.history?.find(x=>x.action==='governance.access_review.revoke')?.audit_id;
if(!revokeAudit)throw Error('Actual revocation history lacks durable audit ID');
const audits=await rest(admin,'audit_log',{select:'id,actor_user_id,action,resource_id',tenant_id:'eq.'+tenant,id:'in.('+[o.request.audit_id,o.approval.audit_id,revokeAudit].join(',')+')'});
check('corrected actual request/approval/revocation audit readback',audits.http===200&&audits.data.length===3,audits);
proof.auditCollectorCorrection={priorFailedCheck:'request/approval/revocation durable audit receipts retained',cause:'Collector expected top-level audit_id; the deployed access-review result exposes it in history. No audit is missing.',actualRevocationAuditId:revokeAudit};
proof.closed=proof.checks.every(x=>x.pass);await evidence('POST-REVOCATION-'+Date.now()+'.json',proof);console.log(JSON.stringify({checks:proof.checks.length,passed:proof.checks.filter(x=>x.pass).length,failed:proof.checks.filter(x=>!x.pass).map(x=>x.name),groupPermissionInspection:proof.groupPermissionInspection}));
