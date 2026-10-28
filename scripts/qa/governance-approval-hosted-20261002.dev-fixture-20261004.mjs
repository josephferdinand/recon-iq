import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { actorSession, verifyReleaseAck } from "./governance-approval-hosted-20261002.mjs";
import { own, privateRoot, releaseAck } from "./governance-approval-hosted-20261002.release-20261004.mjs";
await releaseAck(); await verifyReleaseAck(undefined, "DEV");
const ready = JSON.parse(await readFile(process.env.FVI_GOVERNANCE_SESSION_READINESS_FILE,"utf8"));
const actors = Object.fromEntries(ready.actors.map(a => [a.kind,a]));
if (new Set([actors.requester.user_id,actors.maker.user_id,actors.checker.user_id]).size !== 3) throw new Error("Three actual distinct DEV identities required");
const transport = JSON.parse(await readFile(path.join(privateRoot,"FVI-QA-TRANSPORT-DEV-20261002.json"),"utf8"));
const auth = {}; for (const kind of ["requester","maker","checker"]) auth[kind] = (await actorSession(actors[kind],transport.apiUrl)).token;
const tenant = actors.requester.tenant_id;
if(!process.argv.includes("--execute")){console.log(JSON.stringify({mode:"read-only-preflight",environment:"DEV",three_distinct_real_mfa_actors:true,fixture_mutations:false}));process.exit(0);}
const file = path.join(own,"FIXTURE-DEV-20261004.json");
let manifest; try { manifest = JSON.parse(await readFile(file,"utf8")); } catch(error) { if(error.code !== "ENOENT") throw error; manifest={run_id:randomUUID(),tenant_id:tenant,steps:[],entities:{},status:"PREPARED"}; await writeFile(file,JSON.stringify(manifest),{flag:"wx"}); }
if (manifest.tenant_id !== tenant || manifest.steps.some(s=>s.stage==="before"&&!manifest.steps.some(r=>r.operation===s.operation&&r.stage==="result"))) throw new Error("Uncertain fixture operation requires exact readback; no blind repeat");
if(manifest.status==="READY"&&manifest.input_file){console.log(JSON.stringify({status:"REUSED-SAVED-READY",fixture:file,input:manifest.input_file,hosted_mutations:false}));process.exit(0);}
const save = () => writeFile(file,JSON.stringify(manifest,null,2));
async function call(kind,endpoint,body) {
  if (body) await verifyReleaseAck(undefined,"DEV");
  const response=await fetch(`${transport.apiUrl}/rest/v1/${endpoint}`,{method:body?"POST":"GET",headers:{apikey:transport.anonKey,Authorization:`Bearer ${auth[kind]}`,"Content-Type":"application/json",Prefer:"return=representation"},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  const data=await response.json(); if(!response.ok)throw new Error(`Native DEV ${endpoint.split('?')[0]} HTTP${response.status} ${data.code??"unknown"}`); return data;
}
async function mutate(operation,endpoint,body) { manifest.steps.push({operation,stage:"before",at:new Date().toISOString(),endpoint,body});await save();const result=await call("maker",endpoint,body);manifest.steps.push({operation,stage:"result",at:new Date().toISOString(),result});await save();return result; }
async function entity(key,operation,endpoint,body) { if(manifest.entities[key])return manifest.entities[key];const rows=await mutate(operation,endpoint,body);const id=rows[0]?.id;if(!id)throw new Error(`Exact created ${key} missing`);manifest.entities[key]=id;await save();return id; }
const short=manifest.run_id.slice(0,8);
try {
 const bu=await entity("bu_id","newBU","business_units",{tenant_id:tenant,parent_id:null,name:`Zeno DEV QA ${short}`,code:`ZENO${short.toUpperCase()}`,description:"New synthetic QA scope only",created_by:actors.maker.user_id});
 const workspace=await entity("workspace_id","newWorkspace","workspaces",{tenant_id:tenant,name:`Zeno DEV Governance ${short}`,slug:`zeno-dev-governance-${short}`,description:"New bounded governance QA only",business_unit_id:bu,owner_id:actors.maker.user_id,created_by:actors.maker.user_id,status:"active"});
 const group=await entity("group_id","newGroup","tenant_groups",{tenant_id:tenant,name:`Zeno DEV Read ${short}`,description:"New QA-only group; independent membership approval required",bu_id:bu,created_by:actors.maker.user_id});
 const once=async(operation,endpoint,body)=>{if(!manifest.steps.some(s=>s.operation===operation&&s.stage==="result"))await mutate(operation,endpoint,body);};
 await once("ordinaryBU","bu_user_assignments",{tenant_id:tenant,bu_id:bu,user_id:actors.requester.user_id,role:"bu_viewer",inherit_descendants:false,created_by:actors.maker.user_id});
 await once("ordinaryWorkspace","workspace_members",{tenant_id:tenant,workspace_id:workspace,user_id:actors.requester.user_id,role:"member",added_by:actors.maker.user_id});
 await once("groupBU","bu_group_assignments",{tenant_id:tenant,bu_id:bu,group_id:group,role:"bu_member",inherit_descendants:false,created_by:actors.maker.user_id});
 const role=await entity("role_id","newReadRole","rbac_roles",{tenant_id:tenant,key:`custom_zeno_${short}`,name:`Zeno DEV QA Read ${short}`,description:"New synthetic read role only",is_system:false,is_assignable:true,created_by:actors.maker.user_id});
 await once("roleReadPermission","rbac_role_permissions",{role_id:role,permission_id:"audit.log.read"});
 await once("groupReadRole","tenant_group_roles",{group_id:group,role_id:role,granted_by:actors.maker.user_id});
 if(!manifest.entities.recon_id){
   const sources=await call("maker",`workspace_data_sources?${new URLSearchParams({select:"id,name",tenant_id:`eq.${tenant}`,limit:"100"})}`);
   let source=sources.find(row=>/QA|synthetic|codex/i.test(row.name));
   if(!source){const id=await entity("source_id","newEmptyManualQASource","workspace_data_sources",{tenant_id:tenant,name:`Zeno DEV Synthetic Manual ${short}`,description:"New empty native manual QA source; zero imported rows, no benchmark/extraction claim",source_type:"manual",created_by:actors.maker.user_id});source={id,name:`Zeno DEV Synthetic Manual ${short}`};await once("sourceAudit:datasource.create","audit_log",{actor_user_id:actors.maker.user_id,tenant_id:tenant,scope:"workspace",action:"datasource.create",resource_type:"workspace_data_source",resource_id:id,context:{name:source.name,source_type:"manual"}});}
   const name=`Zeno DEV RLS Probe ${short}`;
   await once("newDraftProbe","rpc/import_recon_definitions_with_owners",{_tenant_id:tenant,_definitions:[{name,description:"New synthetic QA draft only; no run or copied data",recon_type:"one_sided",sides:[{data_source_id:source.id}],rules:[]}],_owner_bu_ids:[bu],_mode:"skip"});
   const rows=await call("maker",`recon_definitions?${new URLSearchParams({select:"id,name,environment",tenant_id:`eq.${tenant}`,name:`eq.${name}`})}`);if(rows.length!==1)throw new Error("Actual new DEV draft readback differs");manifest.entities.recon_id=rows[0].id;manifest.probe_environment=rows[0].environment;await save();
 }
 await once("groupProbeView","rpc/grant_recon_bu_action",{_recon_id:manifest.entities.recon_id,_bu_id:bu,_principal_type:"group",_principal_id:group,_action:"view",_reason:"New owned DEV QA group-only probe; approval/revocation controls ordinary access"});
 for(const [action,resource_type,id,context] of [["bu.create","business_unit",bu,{name:`Zeno DEV QA ${short}`}],["bu.assign_user","business_unit",bu,{user_id:actors.requester.user_id,role:"bu_viewer"}],["group.create","tenant_groups",group,{name:`Zeno DEV Read ${short}`,bu_id:bu}],["rbac.role.create","rbac_roles",role,{name:`Zeno DEV QA Read ${short}`,perm_count:1}],["group.roles.set","tenant_groups",group,{role_ids:[role]}]])await once(`sourceAudit:${action}`,"audit_log",{actor_user_id:actors.maker.user_id,tenant_id:tenant,scope:"tenant",action,resource_type,resource_id:id,context});
 const input={environment:"DEV",app_origin:"https://dev.app.reconiq.example/",supabase_url:transport.apiUrl,publishable_key:transport.anonKey,tenant_id:tenant,tenant_slug:"reconiq-assurance-lab-development",bu_id:bu,workspace_id:workspace,group_id:group,membership_environment:"dev",permission_id:"audit.log.read",resource_probe:{table:"recon_definitions",id:manifest.entities.recon_id},actors:{...actors,observer:actors.requester,lapsed:{...actors.maker,storage_state:JSON.parse(await readFile(path.join(own,"DEV-SESSION-READINESS-2026-10-03T15-03-48-156Z.json"),"utf8")).actors.find(a=>a.kind==="maker").storage_state}}};
 const inputFile=path.join(own,"INPUT-DEV-20261004.json");await writeFile(inputFile,JSON.stringify(input,null,2),{flag:"wx"});manifest.status="READY";manifest.input_file=inputFile;await save();console.log(JSON.stringify({status:manifest.status,fixture:file,input:inputFile,entities:manifest.entities,probe_environment:manifest.probe_environment}));
}catch(error){manifest.status="FAIL";manifest.failure=error.message;await save();console.log(JSON.stringify({status:manifest.status,failure:manifest.failure,fixture:file,entities:manifest.entities}));process.exitCode=1;}
