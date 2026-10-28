// Recovered actor/access/review/audit state only. No mutations or replay.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { actorSession } from "./governance-approval-hosted-20261002.mjs";
import { own, releaseAck } from "./governance-approval-hosted-20261002.release-20261004.mjs";
const ack=await releaseAck();
const input=JSON.parse(await readFile(path.join(own,"INPUT-DEV-20261004.json"),"utf8"));
const ready=JSON.parse(await readFile(process.env.FVI_GOVERNANCE_SESSION_READINESS_FILE,"utf8"));
const actors=Object.fromEntries(ready.actors.map(a=>[a.kind,a]));
for(const kind of ["maker","checker","requester"])if(actors[kind]?.user_id!==input.actors[kind].user_id)throw new Error("Recovery must use the exact retained DEV actors");
const sessions={};for(const kind of ["maker","checker","requester"])sessions[kind]=await actorSession(actors[kind],input.supabase_url);
const proof={at:new Date().toISOString(),ack,mode:"READ-ONLY",status:"RUNNING",roles:{},review_snapshots:[]};
async function read(kind,endpoint){const response=await fetch(`${input.supabase_url}/rest/v1/${endpoint}`,{headers:{apikey:input.publishable_key,Authorization:`Bearer ${sessions[kind].token}`},signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`Current caller read HTTP${response.status}`);return response.json();}
for(const kind of ["maker","checker","requester"]){const rows=await read(kind,`tenant_members?${new URLSearchParams({select:"user_id,role,active",tenant_id:`eq.${input.tenant_id}`,user_id:`eq.${actors[kind].user_id}`})}`);if(rows.length!==1||!rows[0].active||rows[0].role!==(kind==="requester"?"tenant_analyst":"tenant_admin"))throw new Error("Recovered runtime role changed");proof.roles[kind]={user_id:rows[0].user_id,current_role:rows[0].role,real_aal2:true,active:true};}
const members=await read("checker",`tenant_group_members?${new URLSearchParams({select:"group_id,user_id",group_id:`eq.${input.group_id}`,user_id:`eq.${actors.requester.user_id}`})}`);
const resources=await read("requester",`recon_definitions?${new URLSearchParams({select:"id",tenant_id:`eq.${input.tenant_id}`,id:`eq.${input.resource_probe.id}`})}`);
if(members.length!==0||resources.length!==0)throw new Error("Retained revocation current access differs");proof.current_membership_count=0;proof.current_ordinary_resource_rows=0;
const completed=JSON.parse(await readFile(path.join(own,"DEV-ACTUAL-WORKFLOW-20261004.json"),"utf8"));
for(const decision of ["retain","revoke"]){const id=completed[`${decision}_campaign`].item_ids[0];const response=await fetch(`${input.supabase_url}/rest/v1/rpc/governance_access_review_get`,{method:"POST",headers:{apikey:input.publishable_key,Authorization:`Bearer ${sessions.checker.token}`,"Content-Type":"application/json"},body:JSON.stringify({_input:{tenant_id:input.tenant_id,id}}),signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw new Error(`Review retained readback HTTP${response.status}`);if(!Array.isArray(data.permitted_actions)||data.permitted_actions.length!==0||data.version!==2)throw new Error("Completed review must retain version2 and expose no permitted decision actions");proof.review_snapshots.push({id,recorded_outcome:data.outcome??data.governance_outcome??null,version:data.version,snapshot_current:data.snapshot_current,permitted_actions:data.permitted_actions,qualification:"Closed retained history; snapshot_current=false is not a new active-snapshot conflict rejection."});}
const denials=await read("checker",`audit_log?${new URLSearchParams({select:"id,action,actor_user_id,occurred_at",tenant_id:`eq.${input.tenant_id}`,action:"like.governance.*","context->>outcome":"in.(denied,failed)",limit:"100"})}`);
proof.recorded_governance_denials=denials.length;proof.denial_audit_acceptance=denials.length?"REQUIRES-EXACT-CORRELATION":"OPEN-NO-DURABLE-DENIAL-EVENTS";
proof.status="RECOVERED-REAL-ACTORS-REVOCATION-READBACK-PASS-REFUSAL-AUDIT-OPEN";
const stamp=new Date().toISOString().replaceAll(/[:.]/gu,"-");
const inputFile=path.join(own,`INPUT-DEV-RECOVERED-${stamp}.json`);
await writeFile(inputFile,JSON.stringify({...input,actors:{...input.actors,...actors,observer:actors.requester,lapsed:input.actors.lapsed}},null,2),{flag:"wx",mode:0o600});proof.fresh_input_file=inputFile;
const file=path.join(own,`DEV-RECOVERY-READONLY-${stamp}.json`);await writeFile(file,JSON.stringify(proof,null,2),{flag:"wx"});console.log(JSON.stringify({...proof,evidence:file}));
