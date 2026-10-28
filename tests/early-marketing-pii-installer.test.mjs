import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInstaller, buildApplySql, assessState, VERSION, NAME, SOURCE_SHA256,
  ORIGINAL_POLICIES, TABLES } from "../scripts/apply-fvi-early-marketing-pii-boundary.mjs";

const source=await readFile(`supabase/migrations/${VERSION}_${NAME}.sql`,"utf8");
const fakeToken="sbp_SYNTHETIC_NOT_A_REAL_TOKEN_123456789";
const vaultPath="C:\\synthetic\\Falcon-Veritas-Keys.md";
const vault=`<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->\n| \`SUPABASE_ACCESS_TOKEN\` | \`${fakeToken}\` |\n<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->`;
function predecessor() {
  return { latest:"20260923090100",ledger:null,has_role:true,helper_execute:true,profile_select:true,
    active_human_count:1,blocked_human_count:2,service_bypass:true,
    tables:TABLES.map((name)=>({name,rls:true,auth_select:true,service_select:true,service_insert:true})),
    policies:ORIGINAL_POLICIES.map(([table,name,cmd,qual,check])=>({table,name,cmd,qual,check,
      roles:["authenticated"],permissive:"PERMISSIVE"})) };
}
function installed(before) {
  const result=structuredClone(before);
  result.latest=VERSION;
  const policies=TABLES.map((table)=>({table,name:table==="mkt_content_audit_log" ? "mkt_lead_pii_audit_boundary" : "mkt_pii_human_role_boundary",
    cmd:table==="mkt_content_audit_log" ? "SELECT" : "ALL",roles:["authenticated"],permissive:"RESTRICTIVE",
    qual:"synthetic tested policy expression",check:table==="mkt_content_audit_log" ? null : "synthetic tested policy expression"}));
  result.policies.push(...policies);
  result.ledger={name:NAME,statements:[`FVI early marketing PII boundary; sha256=${SOURCE_SHA256}`,JSON.stringify(policies)]};
  return result;
}
async function runFake({state=predecessor(),apply,allowEmpty,after=installed(state),backupAge=1000,changeSource=false}={}) {
  const calls=[]; const output=[]; let wrote=false;
  await runInstaller({env:{FVI_VAULT_PATH:vaultPath,FVI_APPLY_EARLY_MKT_PII:apply,FVI_ALLOW_EMPTY_MKT_OPERATOR:allowEmpty},
    readText:async (file)=>file===vaultPath ? vault : source+(changeSource ? "-- changed" : ""),
    emit:(line)=>output.push(line),
    request:async (url,options)=>{
      const payload=options.body ? JSON.parse(options.body) : null;
      calls.push({url,payload});
      assert.equal(options.headers.authorization,`Bearer ${fakeToken}`);
      assert.match(url,/\/projects\/YOUR_PROJECT_REF\//u);
      if (url.endsWith("database/backups")) return {ok:true,json:async()=>({pitr_enabled:false,
        backups:[{status:"COMPLETED",inserted_at:new Date(Date.now()-backupAge).toISOString()}]})};
      if (payload.read_only===false) { wrote=true; return {ok:true,json:async()=>[]}; }
      return {ok:true,json:async()=>[{state:wrote ? after : state}]};
    }});
  assert.ok(!output.join(" ").includes(fakeToken));
  assert.ok(!output.join(" ").includes("before"));
  return {calls,output:output.map(JSON.parse)};
}

test("default is read-only with fresh backup and reviewed predecessor",async()=>{
  const {calls,output}=await runFake();
  assert.equal(calls.filter((call)=>call.payload?.read_only===false).length,0);
  assert.equal(output[0].dry_run,true);
});
test("only exact YES authorizes one atomic mutation followed by verified readback",async()=>{
  const {calls,output}=await runFake({apply:"YES"});
  const writes=calls.filter((call)=>call.payload?.read_only===false);
  assert.equal(writes.length,1);
  assert.equal((writes[0].payload.query.match(/^BEGIN;$/gmu) ?? []).length,1);
  assert.equal((writes[0].payload.query.match(/^COMMIT;$/gmu) ?? []).length,1);
  assert.equal(output[0].applied,true);
});
test("truthy non-YES values cannot apply",async()=>{
  const {calls}=await runFake({apply:"true"});
  assert.ok(calls.every((call)=>call.payload?.read_only!==false));
});
test("privacy-first empty-operator apply needs a separate exact YES flag",async()=>{
  const state=predecessor(); state.active_human_count=0;
  await assert.rejects(runFake({state,apply:"YES"}),/prerequisites/u);
  const {calls,output}=await runFake({state,apply:"YES",allowEmpty:"YES"});
  assert.equal(calls.filter((call)=>call.payload?.read_only===false).length,1);
  assert.equal(output[0].applied,true);
  assert.equal(output[0].queue_operator_ready,false);
});
test("source change is rejected before any provider call",async()=>{
  await assert.rejects(runFake({changeSource:true}),/checksum/u);
});
test("stale completed backup is rejected",async()=>{
  await assert.rejects(runFake({backupAge:25*60*60*1000}),/prerequisites/u);
});
test("wrong predecessor, disabled RLS, no human queue and broad policy drift fail closed",()=>{
  const wrong=predecessor(); wrong.latest="20260923090000";
  assert.throws(()=>assessState(wrong,true),/predecessor/u);
  const noRls=predecessor(); noRls.tables[0].rls=false;
  assert.throws(()=>assessState(noRls,true),/prerequisites/u);
  const noHuman=predecessor(); noHuman.active_human_count=0;
  assert.throws(()=>assessState(noHuman,true),/prerequisites/u);
  const broad=predecessor(); broad.policies[0].qual="true";
  assert.throws(()=>assessState(broad,true),/policy state/u);
});
test("unverified or changed post-apply restrictive policy is not called applied",async()=>{
  const bad=installed(predecessor()); bad.policies.at(-1).qual="true";
  await assert.rejects(runFake({apply:"YES",after:bad}),/checksum readback/u);
});
test("installed source and policy snapshot can be read back without writes",async()=>{
  const {calls,output}=await runFake({state:installed(predecessor()),apply:"YES"});
  assert.ok(calls.every((call)=>call.payload?.read_only!==false));
  assert.equal(output[0].reused,true);
});
test("transaction guards policy drift before the source and ledger write",()=>{
  const query=buildApplySql(source,predecessor());
  assert.ok(query.indexOf("state changed since preflight")<query.indexOf("CREATE POLICY"));
  assert.ok(query.indexOf("CREATE POLICY")<query.indexOf("INSERT INTO supabase_migrations"));
  assert.match(query,/LOCK TABLE supabase_migrations/u);
});
