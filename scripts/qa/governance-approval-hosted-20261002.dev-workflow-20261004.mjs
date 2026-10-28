// New DEV entities only; no accepted PROD campaign replay. Known 40001 retry
// negatives stay OPEN pending the parent fix rather than flooding live backends.
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { loadInputs, rpc, assertResourceRead, assertMembershipCount, assertExactReplay, verifyLiveRoles, actorSession, membershipChoices } from "./governance-approval-hosted-20261002.mjs";
import { releaseAck, own } from "./governance-approval-hosted-20261002.release-20261004.mjs";
await releaseAck(); const input=await loadInputs(); if(input.environment!=="DEV")throw new Error("DEV-only new workflow");
if(!process.argv.includes("--execute")){const roles=await verifyLiveRoles(input);console.log(JSON.stringify({mode:"read-only-preflight",environment:"DEV",roles,hosted_mutations:false}));process.exit(0);}
const file=path.join(own,"DEV-ACTUAL-WORKFLOW-20261004.json");
const evidence={at:new Date().toISOString(),deployment:"ce449c37-d9cd-4a7a-8d5f-032c881f4e95",status:"RUNNING",steps:[],negative:[],open:["Stale/current-rights conflicts known to raise retrying40001; parent nonretryable business-conflict correction required","Durable denied-attempt audit recording","Human-readable audit identity/scope fallback"]};
await writeFile(file,JSON.stringify(evidence),{flag:"wx"});const save=()=>writeFile(file,JSON.stringify(evidence,null,2));process.env.FVI_GOVERNANCE_EVIDENCE_FILE=file;
const call=async(kind,name,args)=>{evidence.steps.push({at:new Date().toISOString(),kind,name,args,stage:"before"});await save();try{const result=(await rpc(input,input.actors[kind],name,args)).data;evidence.steps.push({kind,name,stage:"result",result});await save();return result;}catch(error){evidence.steps.push({kind,name,stage:"FAIL",http:error.status??null,code:error.code??null,message:error.native_message??error.message});await save();throw error;}};
const deny=async(kind,name,args,label)=>{try{await call(kind,name,args);throw new Error(`${label} unexpectedly allowed`);}catch(error){if(error.code!=="42501")throw error;evidence.negative.push({label,denied:true,http:error.status,code:error.code});await save();}};
try {
 evidence.runtime_roles=await verifyLiveRoles(input);await save();
 for(const [kind,id] of [["bu",input.bu_id],["workspace",input.workspace_id],["group",input.group_id]]){const options=await membershipChoices(input,input.actors.requester,kind);if(!options.some(row=>row.id===id&&row.selectable!==false))throw new Error(`Actual named ordinary ${kind} option missing`);}
 await assertResourceRead(input,false);await assertMembershipCount(input,0);
 const base={_tenant_id:input.tenant_id,_bu_id:input.bu_id,_workspace_id:input.workspace_id,_group_id:input.group_id,_environment:"dev",_reason:"Zeno DEV ordinary requester bounded governed control",_request_key:randomUUID()};
 const request=await call("requester","submit_governance_membership_request",base);evidence.withdrawal_request_id=request.id;await save();assertExactReplay(request,await call("requester","submit_governance_membership_request",base),"ordinary request");
 const withdraw={_tenant_id:input.tenant_id,_request_id:request.id,_expected_version:request.version,_reason:"Zeno DEV ordinary requester withdraws new QA control",_request_key:randomUUID()};
 await deny("checker","withdraw_governance_membership_request",{...withdraw,_request_key:randomUUID()},"independent admin cannot withdraw another requester's own request");
 const closed=await call("requester","withdraw_governance_membership_request",withdraw);assertExactReplay(closed,await call("requester","withdraw_governance_membership_request",withdraw),"withdrawal");await assertMembershipCount(input,0);
 const applyArgs={...base,_reason:"Zeno DEV actual distinct-MFA membership approval QA",_request_key:randomUUID()};
 const pending=await call("requester","submit_governance_membership_request",applyArgs);evidence.approval_request_id=pending.id;await save();assertExactReplay(pending,await call("requester","submit_governance_membership_request",applyArgs),"second request");
 const approve={_tenant_id:input.tenant_id,_request_id:pending.id,_expected_version:pending.version,_decision:"approve",_reason:"Zeno DEV actual independent MFA tenant-admin checker",_request_key:randomUUID()};
 await deny("requester","decide_governance_membership_request",{...approve,_request_key:randomUUID()},"ordinary requester cannot self-approve");
 const approved=await call("checker","decide_governance_membership_request",approve);assertExactReplay(approved,await call("checker","decide_governance_membership_request",approve),"membership decision");
 await assertMembershipCount(input,1);await assertResourceRead(input,true);evidence.actual_approved_access={membership_count:1,ordinary_resource_read:true};await save();
 for(const decision of ["retain","revoke"]){
  const campaignArgs={_input:{tenant_id:input.tenant_id,name:`Zeno DEV actual ${decision} ${randomUUID().slice(0,8)}`,description:"New owned synthetic DEV group only",due_at:new Date(Date.now()+86400000).toISOString(),request_key:randomUUID(),memberships:[{subject_user_id:input.actors.requester.user_id,group_id:input.group_id,reviewer_id:input.actors.checker.user_id,workspace_id:input.workspace_id}]}};
  const campaign=await call("maker","governance_access_review_campaign_create",campaignArgs);evidence[`${decision}_campaign`]=campaign;await save();assertExactReplay(campaign,await call("maker","governance_access_review_campaign_create",campaignArgs),"NEW DEV campaign");
  if(campaign.item_ids?.length!==1)throw new Error("Actual DEV campaign cardinality differs");
  const detail=await call("checker","governance_access_review_get",{_input:{tenant_id:input.tenant_id,id:campaign.item_ids[0]}});if(detail.snapshot_current!==true||!detail.snapshot_hash)throw new Error("Current DEV review snapshot unavailable");
  const args={_input:{tenant_id:input.tenant_id,id:detail.id,expected_version:detail.version,snapshot_hash:detail.snapshot_hash,decision,reason:`Zeno DEV actual independent ${decision}`,request_key:randomUUID()}};
  await deny("maker","governance_access_review_decide",{_input:{...args._input,request_key:randomUUID()}},"campaign creator cannot independently decide");
  const result=await call("checker","governance_access_review_decide",args);assertExactReplay(result,await call("checker","governance_access_review_decide",args),"NEW DEV review decision");
  if(result.outcome!==(decision==="retain"?"retained":"revoked"))throw new Error("Actual DEV outcome differs");await assertMembershipCount(input,decision==="retain"?1:0);await assertResourceRead(input,decision==="retain");evidence[decision]=result;await save();
 }
 const checker=await actorSession(input.actors.checker,input.supabase_url);const ids=[evidence.withdrawal_request_id,evidence.approval_request_id,evidence.retain_campaign.campaign_id,evidence.revoke_campaign.campaign_id,evidence.retain_campaign.item_ids[0],evidence.revoke_campaign.item_ids[0]];
 const response=await fetch(`${input.supabase_url}/rest/v1/audit_log?${new URLSearchParams({select:"id,actor_user_id,occurred_at,action,resource_id,context",tenant_id:`eq.${input.tenant_id}`,resource_id:`in.(${ids.join(',')})`,order:"id.asc"})}`,{headers:{apikey:input.publishable_key,Authorization:`Bearer ${checker.token}`},signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error("Actual DEV correlated audit read failed");evidence.audit=await response.json();
 for(const action of ["governance.membership.withdraw","governance.membership.approve","governance.access_review.retain","governance.access_review.revoke"]){if(evidence.audit.filter(row=>row.action===action).length!==1)throw new Error(`Actual DEV audit cardinality differs ${action}`);}
 evidence.status="ACTUAL-DEV-POSITIVE-WORKFLOW-PASS-OPEN-REFUSAL-AUDIT-GATES";await save();
}catch(error){evidence.status="FAIL";evidence.failure={message:error.native_message??error.message,code:error.code??null,http:error.status??null};await save();process.exitCode=1;}
console.log(JSON.stringify({status:evidence.status,negative:evidence.negative,approved_access:evidence.actual_approved_access,retain:evidence.retain?.outcome,revoke:evidence.revoke?.outcome,audit_count:evidence.audit?.length,failed:evidence.failure,evidence:file}));
