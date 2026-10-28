import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

if (process.env.FVI_ALLOW_RECON_GOVERNANCE_PROOF !== "YES") throw new Error("Set FVI_ALLOW_RECON_GOVERNANCE_PROOF=YES");
const vaultPath = process.env.FVI_VAULT_PATH ?? "";
const makerStatePath = path.resolve(process.env.FVI_MAKER_STORAGE_STATE ?? "");
const checkerStatePath = path.resolve(process.env.FVI_CHECKER_STORAGE_STATE ?? "");
const evidenceRoot = path.resolve("_e2e_run/owner-session");
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") throw new Error("Set the canonical FVI vault");
if (!makerStatePath.startsWith(`${evidenceRoot}${path.sep}`) || !checkerStatePath.startsWith(`${evidenceRoot}${path.sep}`)) throw new Error("Storage states must remain in the protected evidence directory");

function vaultValue(markdown, key) {
  const start = markdown.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
  const end = markdown.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
  const line = markdown.slice(start,end).split(/\r?\n/u).find((candidate) => candidate.startsWith(`| \`${key}\` |`));
  const value = line?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
  if (!value) throw new Error(`Missing vault field ${key}`);
  return value;
}
function sessionFromState(state) {
  return (state.origins ?? []).flatMap((origin) => origin.localStorage ?? []).flatMap((item) => {
    try {
      const parsed = JSON.parse(item.value);
      const session = parsed?.access_token ? parsed : parsed?.currentSession;
      return session?.access_token && session?.refresh_token ? [session] : [];
    } catch { return []; }
  })[0];
}
const vault = await readFile(vaultPath,"utf8");
const anon = vaultValue(vault,"SUPABASE_DEV_ANON_KEY");
const managementToken = vaultValue(vault,"SUPABASE_ACCESS_TOKEN");
const [makerState,checkerState] = await Promise.all([makerStatePath,checkerStatePath].map(async (file) => JSON.parse(await readFile(file,"utf8"))));
const makerSession = sessionFromState(makerState);
const checkerSession = sessionFromState(checkerState);
if (!makerSession || !checkerSession) throw new Error("Protected browser sessions are unavailable");

async function authenticatedClient(session) {
  const client = createClient("https://YOUR_PROJECT_REF.supabase.co",anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const established = await client.auth.setSession({access_token:session.access_token,refresh_token:session.refresh_token});
  if (established.error || !established.data.user) throw new Error("Protected DEV session could not be established");
  return {client,user:established.data.user};
}
const [{client:maker,user:makerUser},{client:checker,user:checkerUser}] = await Promise.all([authenticatedClient(makerSession),authenticatedClient(checkerSession)]);
if (makerUser.id===checkerUser.id) throw new Error("Maker and checker identities must differ");
const {data:tenant,error:tenantError} = await maker.from("tenants").select("id").eq("slug","reconiq-assurance-lab-development").single();
if (tenantError || !tenant) throw new Error("DEV Assurance tenant unavailable");
const {data:definition,error:definitionError} = await maker.from("recon_definitions").select("id,recon_code").eq("tenant_id",tenant.id).order("created_at",{ascending:false}).limit(1).single();
if (definitionError || !definition) throw new Error("Governed reconciliation unavailable");

async function managementQuery(sql,readOnly=false) {
  const response = await fetch("https://api.supabase.com/v1/projects/YOUR_PROJECT_REF/database/query",{
    method:"POST",headers:{authorization:`Bearer ${managementToken}`,"content-type":"application/json"},body:JSON.stringify({query:sql,read_only:readOnly}),
  });
  if (!response.ok) throw new Error(`Management query failed with HTTP ${response.status}`);
  return response.json();
}
const ids = {run:randomUUID(),exception:randomUUID(),rule:randomUUID(),proposal:randomUUID(),manual:randomUUID()};
const stamp = new Date().toISOString();
await managementQuery(`begin;
insert into public.recon_runs(id,tenant_id,definition_id,status,total_rows,started_at,completed_at,run_by)
values ('${ids.run}','${tenant.id}','${definition.id}','completed',2,'${stamp}','${stamp}','${makerUser.id}');
insert into public.recon_exceptions(id,run_id,tenant_id,reason,severity,status,tags,payload)
values ('${ids.exception}','${ids.run}','${tenant.id}','Assurance live amount mismatch','high','open',array['cash','assurance'],'{}');
insert into public.exception_assignment_rules(id,tenant_id,recon_id,name,strategy,assignee_pool,enabled,created_by)
values ('${ids.rule}','${tenant.id}','${definition.id}','Assurance | Live governed round robin','round_robin',array['${checkerUser.id}'::uuid],true,'${makerUser.id}');
insert into public.proposed_matches(id,tenant_id,run_id,definition_id,members,cardinality,ml_score,ml_features,rule_hint)
values ('${ids.proposal}','${tenant.id}','${ids.run}','${definition.id}','{"A":["live-cash-1"],"B":["live-ledger-1"]}','1:1',0.94,'{"amount_delta":0.01}','ml_amount_date');
insert into public.manual_match_approvals(id,tenant_id,run_id,exception_ids,members,cardinality,rationale,proposed_by)
values ('${ids.manual}','${tenant.id}','${ids.run}',array['${ids.exception}'::uuid],'{"A":["live-cash-2"],"B":["live-ledger-2"]}','1:1','Retained live four-eyes evidence','${makerUser.id}');
commit;`);

const assignment = await maker.rpc("assign_exceptions_from_rule",{_tenant_id:tenant.id,_rule_id:ids.rule,_exception_ids:[ids.exception]});
if (assignment.error || assignment.data?.assigned!==1) throw new Error("Live assignment failed");
const makerSelf = await maker.rpc("decide_manual_match_atomic",{_tenant_id:tenant.id,_approval_id:ids.manual,_decision:"approved",_reject_reason:null});
if (!makerSelf.error || !/maker cannot approve/iu.test(makerSelf.error.message)) throw new Error("Maker self-approval was not denied");
const proposed = await checker.rpc("review_proposed_match_atomic",{_tenant_id:tenant.id,_match_id:ids.proposal,_decision:"accepted",_note:"Live confidence and members reviewed"});
if (proposed.error || !proposed.data?.match_id) throw new Error("Live proposed-match review failed");
const manual = await checker.rpc("decide_manual_match_atomic",{_tenant_id:tenant.id,_approval_id:ids.manual,_decision:"approved",_reject_reason:null});
if (manual.error || !manual.data?.match_id) throw new Error("Live manual-match approval failed");
const direct = await checker.from("proposed_matches").update({review_note:"direct bypass"}).eq("id",ids.proposal);
if (!direct.error) throw new Error("Direct proposed-match update unexpectedly succeeded");

const readback = (await managementQuery(`select
  (select assignee='${checkerUser.id}'::uuid from public.recon_exceptions where id='${ids.exception}') as assigned,
  (select status='resolved' from public.recon_exceptions where id='${ids.exception}') as resolved,
  (select status='accepted' from public.proposed_matches where id='${ids.proposal}') as proposed_accepted,
  (select status='approved' and approver_id='${checkerUser.id}'::uuid from public.manual_match_approvals where id='${ids.manual}') as manual_approved,
  (select count(*)::integer from public.recon_match_feedback where recon_id='${definition.id}' and decided_by='${checkerUser.id}') as feedback,
  (select count(*)::integer from public.audit_log where tenant_id='${tenant.id}' and resource_id in ('${ids.exception}','${ids.proposal}','${ids.manual}') and action in ('exception.auto_assigned','proposed_match.accepted','manual_match.approved')) as audits`,true))[0];
if (!readback.assigned || !readback.resolved || !readback.proposed_accepted || !readback.manual_approved || readback.feedback<1 || readback.audits!==3) throw new Error("Live governance readback failed");
console.log(JSON.stringify({ok:true,target:"dev",tenant_slug:"reconiq-assurance-lab-development",recon_code:definition.recon_code,maker_checker_distinct:true,assignment:true,proposed_feedback:true,manual_approval:true,self_approval_denied:true,direct_update_denied:true,audits:readback.audits,retained_ids:ids}));
