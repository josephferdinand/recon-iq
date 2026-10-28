import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {signIn,actorProof,tenant,out,journal,rest,rpc,sha} from './common.mjs';
import {server} from './server.mjs';
const file=path.join(out,'OWNED.json'),s=JSON.parse(await readFile(file,'utf8')),o=s.owned,proof=JSON.parse(await readFile(path.join(out,'WORKFLOW.json'),'utf8'));
if(s.stage!=='ACCESS_WORKFLOW_STOPPED_AT_EXACT_STEP'||s.error!=='Current new membership review snapshot absent'||o.campaign||!o.approval)throw Error('Exact owned review continuation required; no approval/run replay');
const admin=await signIn('volta-recon-dataprep'),viewer=await signIn('kepler-scoped-observer'),checker=await signIn('kepler-org-admin');
if(!admin.tenantAdmin||admin.platformAdmin||viewer.tenantAdmin||viewer.platformAdmin||!checker.tenantAdmin)throw Error('Current role mismatch');
proof.reviewContinuation={at:new Date().toISOString(),actors:[admin,viewer,checker].map(actorProof),sameJWTQualification:'New normal MFA session after collector recovery. Current allow sampled before review; revocation and denial use that exact same JWT. Previous approval/run cases retained, not repeated.'};proof.owned=o;
const save=async()=>{await writeFile(file,JSON.stringify(s,null,2));await writeFile(path.join(out,'WORKFLOW.json'),JSON.stringify(proof,null,2));};
const check=(name,pass,details)=>proof.checks.push({name,pass,details});
async function call(a,name,args,allowError=false){await journal({phase:'intent',actor:a.label,operation:name,args});const r=await rpc(a,name,args);await journal({phase:'result',actor:a.label,operation:name,...r});if(r.http>=400&&!allowError)throw Error(name+' HTTP'+r.http+' '+r.data.code+' '+r.data.message);return r;}
try{
 const before=await rest(viewer,'recon_definitions',{select:'id',tenant_id:'eq.'+tenant,id:'eq.'+o.recon});check('review continuation SAME JWT current allow',before.http===200&&before.data.length===1,before);
 const members=await call(admin,'governance_access_review_options',{_input:{tenant_id:tenant,kind:'members',page:1,page_size:100,search:'',bu_id:o.bu,group_id:o.group,workspace_id:o.workspace,subject_user_id:viewer.id}});
 const member=members.data.rows?.find(x=>x.subject_user_id===viewer.id&&x.group_id===o.group);if(!member?.snapshot_hash)throw Error('Exact filtered new membership unavailable without search');
 const campaign=await call(admin,'governance_access_review_campaign_create',{_input:{tenant_id:tenant,name:s.label+' current access review',description:'New owned membership only',due_at:new Date(Date.now()+86400000).toISOString(),request_key:randomUUID(),memberships:[{subject_user_id:viewer.id,group_id:o.group,reviewer_id:checker.id,workspace_id:o.workspace,snapshot_hash:member.snapshot_hash}]}});o.campaign=campaign.data;await save();
 if(o.campaign.item_ids?.length!==1)throw Error('Exactly one owned review item required');
 const review=await call(checker,'governance_access_review_get',{_input:{tenant_id:tenant,id:o.campaign.item_ids[0]}});proof.reviewBefore=review.data;if(review.data.snapshot_current!==true)throw Error('Current snapshot unavailable');
 const wrongVersion=await call(checker,'governance_access_review_decide',{_input:{tenant_id:tenant,id:review.data.id,expected_version:review.data.version+1,snapshot_hash:review.data.snapshot_hash,decision:'revoke',reason:'Euler stale version must not change new membership',request_key:randomUUID()}},true);check('stale current review version refused with bounded 409',wrongVersion.http===409&&wrongVersion.data.code==='PT409',wrongVersion);
 const revoke=await call(checker,'governance_access_review_decide',{_input:{tenant_id:tenant,id:review.data.id,expected_version:review.data.version,snapshot_hash:review.data.snapshot_hash,decision:'revoke',reason:'Euler revoke only newly granted owned QA group membership',request_key:randomUUID()}});o.revocation=revoke.data;await save();
 check('actual independent current-snapshot revocation',revoke.data.outcome==='revoked'&&revoke.data.membership_revoked===true,revoke.data);
 for(const [table,id] of [['recon_definitions',o.recon],['data_prep_pipelines',o.pipeline],['workspace_data_sources',o.source]]){const r=await rest(viewer,table,{select:'id',tenant_id:'eq.'+tenant,id:'eq.'+id});check('revoked SAME JWT '+table+' read denied',r.http===200&&r.data.length===0,r);}
 for(const action of ['view','run','edit']){const r=await call(viewer,'recon_authoritative_access_decision',{_recon:o.recon,_action:action});check('revoked SAME JWT recon '+action+' denied',r.data===false,r);}
 const exported=await server(viewer,'exportReconDefinitions',{tenant_id:tenant,ids:[o.recon]});check('revoked SAME JWT scoped export excludes new recon',!exported.error&&exported.data?.count===0,{http:exported.http,error:exported.error,count:exported.data?.count});
 const group=await rest(admin,'tenant_group_members',{select:'user_id',group_id:'eq.'+o.group,user_id:'eq.'+viewer.id});check('exact new group membership revoked',group.http===200&&group.data.length===0,group);
 const roles=await rest(admin,'tenant_members',{select:'tenant_id,user_id,role,active',tenant_id:'eq.'+tenant});check('old tenant roles unchanged through full grant/review/revoke',sha([...roles.data].sort((a,b)=>a.user_id.localeCompare(b.user_id)))===sha([...s.oldTenantRoles.data].sort((a,b)=>a.user_id.localeCompare(b.user_id))));
 const revokeAudit=revoke.data.audit_id??revoke.data.history?.find(x=>x.action==='governance.access_review.revoke')?.audit_id;
 const audits=await rest(admin,'audit_log',{select:'id,actor_user_id,action,resource_id',tenant_id:'eq.'+tenant,id:'in.('+[o.request.audit_id,o.approval.audit_id,revokeAudit].filter(Boolean).join(',')+')'});proof.exactAudits=audits;
 check('request/approval/revocation durable audit receipts retained',audits.http===200&&audits.data.length===3,audits);
 proof.closed=proof.checks.every(x=>x.pass);s.stage=proof.closed?'ACCESS_FULL_ACCEPTANCE_PASS':'ACCESS_GAPS_REPRODUCED';delete s.error;delete proof.error;
}catch(e){s.stage='ACCESS_REVIEW_STOPPED_AT_EXACT_STEP';s.error=e.message;proof.error=e.message;process.exitCode=1;}
await save();console.log(JSON.stringify({stage:s.stage,checks:proof.checks.length,passed:proof.checks.filter(x=>x.pass).length,failed:proof.checks.filter(x=>!x.pass).map(x=>x.name),error:proof.error??null,revocation:o.revocation}));
