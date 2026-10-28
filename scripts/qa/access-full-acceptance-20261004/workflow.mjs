import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {signIn,actorProof,tenant,out,evidence,journal,rest,rpc,load,sha} from './common.mjs';
import {server} from './server.mjs';
const file=path.join(out,'OWNED.json'),s=JSON.parse(await readFile(file,'utf8')),o=s.owned;
const resume=s.stage==='ACCESS_WORKFLOW_STOPPED_AT_EXACT_STEP'&&s.error==="Cannot read properties of undefined (reading 'split')"&&!o.request;
if(s.stage!=='READY_FOR_REQUEST_GRANT_REVOKE'&&!resume)throw Error('Exact new owned setup required; no workflow replay');
const admin=await signIn('volta-recon-dataprep'),viewer=await signIn('kepler-scoped-observer'),outsider=await signIn('nonadmin-analyst'),checker=await signIn('kepler-org-admin');
if(!admin.tenantAdmin||admin.platformAdmin||viewer.tenantAdmin||viewer.platformAdmin||outsider.tenantAdmin||outsider.platformAdmin||!checker.tenantAdmin)throw Error('Authoritative role boundary failed');
const proof=resume?JSON.parse(await readFile(path.join(out,'WORKFLOW.json'),'utf8')):{at:new Date().toISOString(),run:s.run,actors:[admin,viewer,outsider,checker].map(actorProof),checks:[],phases:[],owned:o,closed:false};
proof.owned=o;
if(resume){delete proof.error;proof.recoveredAt=new Date().toISOString();proof.resumedActors=[admin,viewer,outsider,checker].map(actorProof);proof.sameJWTQualification='Fresh normal AAL2 session established on resume; current owned recon denial checked before grant. Approval and revocation use this same JWT. Earlier 15 checks retained separately.';}
const save=async()=>{await writeFile(file,JSON.stringify(s,null,2));await writeFile(path.join(out,'WORKFLOW.json'),JSON.stringify(proof,null,2));};
const check=(name,pass,details)=>{proof.checks.push({name,pass,details});};
async function call(a,name,args,{allowError=false}={}){await journal({phase:'intent',actor:a.label,operation:name,args});const r=await rpc(a,name,args);await journal({phase:'result',actor:a.label,operation:name,...r});if(r.http>=400&&!allowError)throw Error(name+' HTTP'+r.http+' '+r.data?.code+' '+r.data?.message);return r;}
async function app(a,name,args,options){await journal({phase:'intent',actor:a.label,operation:name,args});const r=await server(a,name,args,options);await journal({phase:'result',actor:a.label,operation:name,...r});return r;}
const perm=async(a,id)=>(await call(a,'user_has_permission',{_user_id:a.id,_tenant_id:tenant,_permission_id:id,_bu_id:o.bu})).data;
async function accessPhase(label,a,allow){
 const phase={label,actor:a.label,expectedResourceAllow:allow,roots:{},decisions:{}};
 for(const [table,id] of [['recon_definitions',o.recon],['data_prep_pipelines',o.pipeline],['workspace_data_sources',o.source]]){const r=await rest(a,table,{select:'id',tenant_id:'eq.'+tenant,id:'eq.'+id});phase.roots[table]=r;check(label+' '+table+' current RLS',r.http===200&&Array.isArray(r.data)&&r.data.length===(allow?1:0),r);}
 for(const action of ['view','run','edit']){const r=await call(a,'recon_authoritative_access_decision',{_recon:o.recon,_action:action});phase.decisions[action]=r.data;check(label+' recon '+action+' decision',r.data===allow,r);}
 const exported=await app(a,'exportReconDefinitions',{tenant_id:tenant,ids:[o.recon]});phase.export=exported;check(label+' scoped actual export',!exported.error&&exported.data?.count===(allow?1:0),{http:exported.http,error:exported.error,count:exported.data?.count});
 phase.exportPermission=await perm(a,'audit.log.export');
 proof.phases.push(phase);await save();
}
try{
 s.stage='WORKFLOW_STARTED';await save();
 if(!resume){const roleBefore=await rest(admin,'tenant_members',{select:'tenant_id,user_id,role,active',tenant_id:'eq.'+tenant});
 check('old tenant roles preserved since owned setup',sha([...roleBefore.data].sort((a,b)=>a.user_id.localeCompare(b.user_id)))===sha([...s.oldTenantRoles.data].sort((a,b)=>a.user_id.localeCompare(b.user_id))));
 await accessPhase('before approval',viewer,false);await accessPhase('nonmember group control',outsider,false);}
 if(resume){const current=await rest(viewer,'recon_definitions',{select:'id',tenant_id:'eq.'+tenant,id:'eq.'+o.recon});check('resumed current JWT before-grant recon deny',current.http===200&&current.data.length===0,current);}
 const expiredRecord=await load('FVI-QA-SESSION-kepler-scoped-observer-20261001T173519429Z-5d2d4533.json');const expired=expiredRecord.session??expiredRecord;
 const c=JSON.parse(Buffer.from(expired.access_token.split('.')[1],'base64url'));if(c.sub!==viewer.id||c.exp*1000>=Date.now())throw Error('Actual retained expired actor token required');
 const lapsed=await rest({session:expired},'recon_definitions',{select:'id',id:'eq.'+o.recon,tenant_id:'eq.'+tenant});check('actual expired session denied',lapsed.http===401,lapsed);
 for(const [name,args] of [['runReconDefinition',{tenant_id:tenant,id:o.recon}],['runCorrelatedDataPrepPipeline',{tenant_id:tenant,pipeline_id:o.pipeline,request_key:randomUUID()}]]){const r=await app(outsider,name,args);check('nonmember '+name+' actual refusal',!!r.error||r.http>=400,{error:r.error,http:r.http});}
 const options=await call(viewer,'list_governance_membership_options',{_tenant_id:tenant,_kind:'group',_page:1,_page_size:25,_search:s.label,_bu_id:o.bu,_workspace_id:o.workspace,_environment:'prod'});check('new scoped group selectable in requester flow',options.data.rows?.some(x=>x.id===o.group)===true,options.data);
 const requested=await call(viewer,'submit_governance_membership_request',{_tenant_id:tenant,_bu_id:o.bu,_workspace_id:o.workspace,_group_id:o.group,_environment:'prod',_reason:'Euler new owned independent access acceptance',_request_key:randomUUID()});
 o.request=requested.data;await save();if(!o.request?.id||o.request.status!=='pending')throw Error('Actual pending request absent');
 const requesterDecision=await call(viewer,'decide_governance_membership_request',{_tenant_id:tenant,_request_id:o.request.id,_expected_version:o.request.version,_decision:'approve',_reason:'Own requester must not approve',_request_key:randomUUID()},{allowError:true});check('ordinary requester cannot approve own request',requesterDecision.http>=400&&requesterDecision.data.code==='42501',requesterDecision);
 const detail=await call(admin,'get_governance_membership_request',{_tenant_id:tenant,_request_id:o.request.id});proof.requestDetail=detail.data;check('current independent approval permission',detail.data.permissions?.can_approve===true&&detail.data.membership_active===false);
 const approval=await call(admin,'decide_governance_membership_request',{_tenant_id:tenant,_request_id:o.request.id,_expected_version:o.request.version,_decision:'approve',_reason:'Pure tenant administrator independently approves new QA request',_request_key:randomUUID()});o.approval=approval.data;await save();
 check('actual independently approved grant/audit receipt',approval.data.status==='approved'&&approval.data.outcome==='grant_confirmed'&&!!approval.data.audit_id,approval.data);
 await accessPhase('after independent approval SAME JWT',viewer,true);await accessPhase('nonmember after approval',outsider,false);
 const reconRead=await rest(admin,'recon_definitions',{select:'id,name,recon_type,sides,rules,status,environment,governance_state,access_mode',id:'eq.'+o.recon,tenant_id:'eq.'+tenant});
 const def=reconRead.data[0];if(!def)throw Error('Exact new recon missing');proof.newReconState=def;
 const edit=await app(viewer,'upsertRecon',{id:o.recon,tenant_id:tenant,name:s.label+' Recon edited by scoped member',recon_type:def.recon_type,sides:def.sides,rules:def.rules});check('ordinary authorized recon edit persisted',!edit.error&&edit.data?.id===o.recon,edit);const edited=await rest(admin,'recon_definitions',{select:'name',id:'eq.'+o.recon,tenant_id:'eq.'+tenant});check('ordinary recon edit actual row readback',edited.data?.[0]?.name===s.label+' Recon edited by scoped member',edited);
 const run=await app(viewer,'runReconDefinition',{id:o.recon,tenant_id:tenant});proof.reconRun=run;check('ordinary owned recon actual run',!run.error&&!!run.data,run);
 const dpEdit=await app(viewer,'upsertPipeline',{id:o.pipeline,tenant_id:tenant,name:s.label+' Pipeline edited by scoped member',source_data_source_id:o.source,steps:[{kind:'trim',field:'ref'}],dq_rules:[],on_failure:'block',enabled:true});check('ordinary mapped DataPrep edit',!dpEdit.error&&dpEdit.data?.id===o.pipeline,dpEdit);
 o.dataPrepRequestKey=randomUUID();await save();const dp=await app(viewer,'runCorrelatedDataPrepPipeline',{tenant_id:tenant,pipeline_id:o.pipeline,request_key:o.dataPrepRequestKey});proof.dataPrepRun=dp;check('ordinary mapped DataPrep actual run',!dp.error&&['success','warn'].includes(dp.data?.status),dp);
 const members=await call(admin,'governance_access_review_options',{_input:{tenant_id:tenant,kind:'members',page:1,page_size:100,search:s.label,bu_id:o.bu,group_id:o.group,workspace_id:o.workspace,subject_user_id:viewer.id}});
 const member=members.data.rows?.find(x=>x.subject_user_id===viewer.id&&x.group_id===o.group);if(!member?.snapshot_hash)throw Error('Current new membership review snapshot absent');
 const campaign=await call(admin,'governance_access_review_campaign_create',{_input:{tenant_id:tenant,name:s.label+' current access review',description:'New owned membership only',due_at:new Date(Date.now()+86400000).toISOString(),request_key:randomUUID(),memberships:[{subject_user_id:viewer.id,group_id:o.group,reviewer_id:checker.id,workspace_id:o.workspace,snapshot_hash:member.snapshot_hash}]}});o.campaign=campaign.data;await save();
 if(o.campaign.item_ids?.length!==1)throw Error('Exactly one owned review item required');
 const review=await call(checker,'governance_access_review_get',{_input:{tenant_id:tenant,id:o.campaign.item_ids[0]}});proof.reviewBefore=review.data;
 if(review.data.snapshot_current!==true)throw Error('Current review snapshot required');
 const revoke=await call(checker,'governance_access_review_decide',{_input:{tenant_id:tenant,id:review.data.id,expected_version:review.data.version,snapshot_hash:review.data.snapshot_hash,decision:'revoke',reason:'Euler revoke only newly granted owned QA group membership',request_key:randomUUID()}});o.revocation=revoke.data;await save();
 check('actual independent current-snapshot revocation',revoke.data.outcome==='revoked'&&revoke.data.membership_revoked===true,revoke.data);
 await accessPhase('after revocation SAME JWT',viewer,false);
 const oldRoles=await rest(admin,'tenant_members',{select:'tenant_id,user_id,role,active',tenant_id:'eq.'+tenant});check('old tenant roles unchanged after full access cycle',sha([...oldRoles.data].sort((a,b)=>a.user_id.localeCompare(b.user_id)))===sha([...s.oldTenantRoles.data].sort((a,b)=>a.user_id.localeCompare(b.user_id))));
 proof.closed=proof.checks.every(x=>x.pass);s.stage=proof.closed?'ACCESS_FULL_ACCEPTANCE_PASS':'ACCESS_GAPS_REPRODUCED';
}catch(e){s.stage='ACCESS_WORKFLOW_STOPPED_AT_EXACT_STEP';s.error=e.message;proof.error=e.message;process.exitCode=1;}
await save();console.log(JSON.stringify({stage:s.stage,checks:proof.checks.length,passed:proof.checks.filter(x=>x.pass).length,failed:proof.checks.filter(x=>!x.pass).map(x=>x.name),error:proof.error??null,owned:o}));
