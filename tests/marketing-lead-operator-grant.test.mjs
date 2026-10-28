import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assessIdentity, assessBoundary, buildGrantSql, runGrant, OPERATOR_EMAIL, VAULT_PATH, IDENTITY_SQL }
  from "../scripts/grant-fvi-marketing-lead-operator.mjs";
import { VERSION, NAME, SOURCE_SHA256, TABLES, ORIGINAL_POLICIES }
  from "../scripts/apply-fvi-early-marketing-pii-boundary.mjs";

const source=await readFile(`supabase/migrations/${VERSION}_${NAME}.sql`,"utf8");
const fakeToken="sbp_SYNTHETIC_NOT_A_REAL_TOKEN_123456789";
const vault=`<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->\n| \`SUPABASE_ACCESS_TOKEN\` | \`${fakeToken}\` |\n<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->`;
const fakeId="00000000-0000-4000-8000-000000000001";
function candidate() {
  return {users:[{id:fakeId,email:OPERATOR_EMAIL.toLowerCase(),usable:true,platform_admin:true,profiles:[],roles:[]}]};
}
function installedIdentity() {
  const value=candidate(); value.users[0].profiles=[{status:"active"}];
  value.users[0].roles=[{role:"marketing_admin",granted_by:fakeId,granted_at:"2026-09-28T00:00:00Z"}];
  return value;
}
function boundary() {
  const restricted=TABLES.map((table)=>({table,
    name:table==="mkt_content_audit_log" ? "mkt_lead_pii_audit_boundary" : "mkt_pii_human_role_boundary",
    cmd:table==="mkt_content_audit_log" ? "SELECT" : "ALL",roles:["authenticated"],permissive:"RESTRICTIVE",
    qual:"synthetic fixture expression",check:table==="mkt_content_audit_log" ? null : "synthetic fixture expression"}));
  return {latest:VERSION,ledger:{name:NAME,statements:[`FVI early marketing PII boundary; sha256=${SOURCE_SHA256}`,JSON.stringify(restricted)]},
    has_role:true,helper_execute:true,profile_select:true,service_bypass:true,active_human_count:0,blocked_human_count:0,
    tables:TABLES.map((name)=>({name,rls:true,auth_select:true,service_select:true,service_insert:true})),
    policies:[...ORIGINAL_POLICIES.map(([table,name,cmd,qual,check])=>({table,name,cmd,qual,check,
      roles:["authenticated"],permissive:"PERMISSIVE"})),...restricted]};
}
async function fakeRun({identity=candidate(),privacy=boundary(),flag,after=installedIdentity(),changedSource=false,
  vaultText=vault,env={},calls=[],output=[]}={}) {
  let wrote=false;
  await runGrant({env:{...env,FVI_GRANT_MKT_LEAD_OPERATOR:flag},
    readText:async(file)=>file===VAULT_PATH ? vaultText : source+(changedSource ? "changed" : ""),
    emit:(value)=>output.push(value),request:async(url,options)=>{
      assert.match(url,/^https:\/\/api\.supabase\.com\/v1\/projects\/YOUR_PROJECT_REF\/database\/query$/u);
      assert.equal(options.headers.authorization,`Bearer ${fakeToken}`);
      const payload=JSON.parse(options.body); calls.push(payload);
      if (payload.read_only===false) { wrote=true; return {ok:true,json:async()=>[]}; }
      return {ok:true,json:async()=>payload.query===IDENTITY_SQL ? [{identity:wrote ? after : identity}] : [{state:privacy}]};
    }});
  assert.ok(!output.join(" ").includes(fakeToken));
  assert.ok(!output.join(" ").includes(fakeId));
  return {calls,output:output.map(JSON.parse)};
}

test("default is read-only and accepts case-insensitive exact owner email",async()=>{
  const {calls,output}=await fakeRun();
  assert.equal(calls.length,2); assert.ok(calls.every((call)=>call.read_only===true));
  assert.equal(output[0].dry_run,true);
});
test("only exact YES writes one atomic transaction and verifies readback",async()=>{
  const {calls,output}=await fakeRun({flag:"YES"});
  assert.equal(calls.length,5); assert.equal(calls.filter((call)=>call.read_only===false).length,1);
  assert.equal(output[0].applied,true);
  const readOnly=await fakeRun({flag:"true"}); assert.ok(readOnly.calls.every((call)=>call.read_only));
});
test("repeat active marketing administrator is idempotent without audit duplication",async()=>{
  const {calls,output}=await fakeRun({identity:installedIdentity(),flag:"YES"});
  assert.ok(calls.every((call)=>call.read_only)); assert.equal(output[0].reused,true);
});
test("wrong, missing, duplicated, unconfirmed, banned or non-platform-admin identities fail closed",async()=>{
  const wrongEmail=candidate(); wrongEmail.users[0].email="other@reconiq.example";
  const duplicate=candidate(); duplicate.users.push(structuredClone(duplicate.users[0]));
  const unusable=candidate(); unusable.users[0].usable=false;
  const wrongRole=candidate(); wrongRole.users[0].platform_admin=false;
  const forgedId=candidate(); forgedId.users[0].id="anything'; DROP TABLE public.mkt_admin_roles; --";
  for (const identity of [wrongEmail,{users:[]},duplicate,unusable,wrongRole,forgedId]) {
    const calls=[];
    await assert.rejects(fakeRun({identity,flag:"YES",calls}),/Marketing operator/u);
    assert.ok(calls.every((call)=>call.read_only));
  }
});
test("existing sales, super, AI or duplicate marketing roles require review",()=>{
  for (const roles of [[{role:"sales_admin"}],[{role:"super_admin"}],[{role:"ai_admin"}],
    [{role:"marketing_admin"},{role:"marketing_admin"}]]) {
    const identity=candidate(); identity.users[0].roles=roles;
    assert.throws(()=>assessIdentity(identity),/unexpected/u);
  }
});
test("missing early ledger, wrong source marker, missing RLS and policy drift fail closed",async()=>{
  const missing=boundary(); missing.ledger=null;
  const wrongSource=boundary(); wrongSource.ledger.statements[0]="wrong source";
  const noRls=boundary(); noRls.tables[0].rls=false;
  const missingPolicy=boundary(); missingPolicy.policies.pop();
  const changedPolicy=boundary(); changedPolicy.policies.at(-1).qual="true";
  for (const privacy of [missing,wrongSource,noRls,missingPolicy,changedPolicy]) {
    const calls=[]; await assert.rejects(fakeRun({privacy,flag:"YES",calls}));
    assert.ok(calls.every((call)=>call.read_only));
  }
  assert.doesNotThrow(()=>assessBoundary(boundary()));
});
test("changed local source or ambiguous/noncanonical credentials fail before any request",async()=>{
  for (const settings of [{changedSource:true},{vaultText:vault+vault},{vaultText:vault.replace("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->",
    `| \`SUPABASE_ACCESS_TOKEN\` | \`${fakeToken}\` |\n<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->`)},
    {env:{FVI_VAULT_PATH:"C:/unrelated/Falcon-Veritas-Keys.md"}}]) {
    const calls=[]; await assert.rejects(fakeRun({...settings,calls,flag:"YES"})); assert.equal(calls.length,0);
  }
});
test("bad post-write readback never emits success",async()=>{
  const output=[]; await assert.rejects(fakeRun({flag:"YES",after:candidate(),output}),/readback/u);
  assert.deepEqual(output,[]);
  const other=installedIdentity(); other.users[0].id="00000000-0000-4000-8000-000000000002";
  await assert.rejects(fakeRun({flag:"YES",after:other}),/readback/u);
});
test("transaction grants only the confirmed user marketing_admin and preserves grant/profile data",()=>{
  const sql=buildGrantSql(candidate(),boundary());
  assert.equal((sql.match(/^BEGIN;/gmu) ?? []).length,1);
  assert.equal((sql.match(/^COMMIT;/gmu) ?? []).length,1);
  assert.match(sql,/LOCK TABLE auth\.users,public\.platform_roles,public\.mkt_admin_users,public\.mkt_admin_roles/u);
  assert.ok(sql.indexOf("changed since preflight")<sql.indexOf("INSERT INTO public.mkt_admin_users"));
  assert.match(sql,/ON CONFLICT \(user_id,role\) DO NOTHING/u);
  assert.match(sql,/INSERT INTO public\.mkt_admin_roles\(user_id,role,granted_by\)\s+VALUES \('[\da-f-]+'::uuid,'marketing_admin'::public\.mkt_admin_role,'[\da-f-]+'::uuid\)/u);
  assert.match(sql,/INSERT INTO public\.mkt_content_audit_log/u);
  assert.doesNotMatch(sql,/\b(?:DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT)\b/u);
  assert.doesNotMatch(sql,/INSERT INTO public\.platform_roles|SET display_name|SET granted_by/u);
  assert.ok(sql.indexOf("final grant invariant failed")<sql.indexOf("COMMIT;"));
});
