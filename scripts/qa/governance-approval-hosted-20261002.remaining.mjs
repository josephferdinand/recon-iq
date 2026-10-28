import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { loadInputs, actorSession, verifyReleaseAck, rpc, assertResourceRead, assertMembershipCount, assertExactReplay } from "./governance-approval-hosted-20261002.mjs";
const input=await loadInputs();await verifyReleaseAck(undefined,input.environment);
const outputFile=process.env.FVI_GOVERNANCE_EVIDENCE_FILE;
const evidence={at:new Date().toISOString(),deployment:"5fbb724d-225e-4c75-998d-93fbab993cb4",prior_failure:"Stale-withdrawal/refusal/detail RPC upstream timeout; exact request direct RLS read remained pending version1",steps:[],negative:[],status:"RUNNING"};
const save=()=>writeFile(outputFile,JSON.stringify(evidence,null,2));await writeFile(outputFile,JSON.stringify(evidence),{flag:"wx"});
const call=async(kind,name,args)=>{evidence.steps.push({at:new Date().toISOString(),kind,name,args,stage:"before"});await save();try{const result=(await rpc(input,input.actors[kind],name,args)).data;evidence.steps.push({at:new Date().toISOString(),kind,name,stage:"result",result});await save();return result;}catch(error){evidence.steps.push({kind,name,stage:"FAIL",http:error.status??null,code:error.code??null,message:error.native_message??error.message});await save();throw error;}};
const deny=async(kind,name,args,label)=>{try{await call(kind,name,args);throw new Error(`${label} unexpectedly allowed`);}catch(error){if(error.code!=="42501")throw error;evidence.negative.push({label,denied:true,http:error.status,code:error.code});await save();}};
try{
  const withdrawalArgs={_tenant_id:input.tenant_id,_request_id:"d387d3c8-6eee-41b7-a61c-f0ff5cac83e3",_expected_version:1,_reason:"Requester withdrew bounded QA request",_request_key:randomUUID()};
  const withdrawn=await call("requester","withdraw_governance_membership_request",withdrawalArgs);if(withdrawn.status!=="withdrawn"||withdrawn.version!==2)throw new Error("Correct-version withdrawal readback differs");
  assertExactReplay(withdrawn,await call("requester","withdraw_governance_membership_request",withdrawalArgs),"withdrawal");await assertMembershipCount(input,0);
  const submissionArgs={_tenant_id:input.tenant_id,_bu_id:input.bu_id,_workspace_id:input.workspace_id,_group_id:input.group_id,_environment:input.membership_environment,_reason:"Zeno actual post-release independent approval QA",_request_key:randomUUID()};
  const request=await call("requester","submit_governance_membership_request",submissionArgs);if(request.status!=="pending"||request.version!==1)throw new Error("Request contract differs");assertExactReplay(request,await call("requester","submit_governance_membership_request",submissionArgs),"request");
  const approvalArgs={_tenant_id:input.tenant_id,_request_id:request.id,_expected_version:request.version,_decision:"approve",_reason:"Zeno actual independent MFA checker approval",_request_key:randomUUID()};
  await deny("requester","decide_governance_membership_request",{...approvalArgs,_request_key:randomUUID()},"ordinary requester cannot self-approve");
  const approval=await call("checker","decide_governance_membership_request",approvalArgs);if(approval.outcome!=="grant_confirmed"||approval.status!=="approved")throw new Error("Approved membership not applied");assertExactReplay(approval,await call("checker","decide_governance_membership_request",approvalArgs),"approval");
  await assertMembershipCount(input,1);await assertResourceRead(input,true);evidence.applied_access={membership_count:1,ordinary_resource_read:true};await save();
  for(const decision of ["retain","revoke"]){
    const campaignArgs={_input:{tenant_id:input.tenant_id,name:`Zeno actual ${decision} ${randomUUID().slice(0,8)}`,description:"New bounded synthetic QA membership only",due_at:new Date(Date.now()+86400000).toISOString(),request_key:randomUUID(),memberships:[{subject_user_id:input.actors.requester.user_id,group_id:input.group_id,reviewer_id:input.actors.checker.user_id,workspace_id:input.workspace_id}]}};
    const campaign=await call("maker","governance_access_review_campaign_create",campaignArgs);assertExactReplay(campaign,await call("maker","governance_access_review_campaign_create",campaignArgs),"campaign");if(campaign.item_ids?.length!==1)throw new Error("Campaign is not exactly one actual review item");
    const detail=await call("checker","governance_access_review_get",{_input:{tenant_id:input.tenant_id,id:campaign.item_ids[0]}});if(detail.snapshot_current!==true||!detail.snapshot_hash)throw new Error("Current review snapshot unavailable");
    const args={_input:{tenant_id:input.tenant_id,id:detail.id,expected_version:detail.version,snapshot_hash:detail.snapshot_hash,decision,reason:`Zeno actual independent ${decision}`,request_key:randomUUID()}};
    await deny("maker","governance_access_review_decide",{_input:{...args._input,request_key:randomUUID()}},"campaign creator cannot independently decide");
    const outcome=await call("checker","governance_access_review_decide",args);if(outcome.outcome!==(decision==="retain"?"retained":"revoked"))throw new Error("Review decision differs");assertExactReplay(outcome,await call("checker","governance_access_review_decide",args),"review decision");
    await assertMembershipCount(input,decision==="retain"?1:0);await assertResourceRead(input,decision==="retain");
    evidence[decision]={review_id:detail.id,campaign_id:campaign.campaign_id,outcome:outcome.outcome,version:outcome.version,membership_revoked:outcome.membership_revoked};await save();
  }
  const {token}=await actorSession(input.actors.checker,input.supabase_url);const ids=[withdrawn.id,request.id,evidence.retain.review_id,evidence.revoke.review_id,evidence.retain.campaign_id,evidence.revoke.campaign_id];
  const response=await fetch(`${input.supabase_url}/rest/v1/audit_log?${new URLSearchParams({select:"id,actor_user_id,occurred_at,action,resource_id,context",tenant_id:`eq.${input.tenant_id}`,resource_id:`in.(${ids.join(',')})`,order:"id.asc"})}`,{headers:{apikey:input.publishable_key,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error("Actual audit read failed");const rows=await response.json();evidence.audit=rows.map(row=>({id:String(row.id),actor_user_id:row.actor_user_id,occurred_at:row.occurred_at,action:row.action,resource_id:row.resource_id,reason:row.context?.reason??null,version:row.context?.version??null,correlation_id:row.context?.correlation_id??null,outcome:row.context?.outcome??null}));
  for(const action of ["governance.membership.withdraw","governance.membership.approve","governance.access_review.retain","governance.access_review.revoke"]){if(evidence.audit.filter(row=>row.action===action).length!==1)throw new Error(`Exact audit cardinality failed for ${action}`);}
  evidence.status="POSITIVE-WORKFLOW-PASS-WITH-RETAINED-REFUSAL-TIMEOUT";await save();
}catch(error){evidence.status="FAIL";evidence.failure={http:error.status??null,code:error.code??null,message:error.native_message??error.message};await save();process.exitCode=1;}
console.log(JSON.stringify({status:evidence.status,steps:evidence.steps.length,failure:evidence.failure??null,evidence_file:outputFile}));
