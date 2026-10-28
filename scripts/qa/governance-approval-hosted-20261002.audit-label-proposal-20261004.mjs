// Review-only single-line fix tested with the actual pure projector and retained
// live event rows. No source overwrite, mocked live authorization or hosted write.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";
import { z } from "zod";
import { own } from "./governance-approval-hosted-20261002.release-20261004.mjs";
const relative="src/lib/governance-audit.functions.ts";
const source=await readFile(relative,"utf8");
const before="    actor_name: row.actor_user_id ? labels.get(row.actor_user_id) ?? null : null,";
const after="    actor_name: row.actor_user_id ? labels.get(row.actor_user_id) ?? row.actor_user_id : null,";
assert.equal(source.split(before).length,2,"Exact current single-line projector preimage required");
const updated=source.replace(before,after);assert.equal(updated.replace(after,before),source);
function projector(text){
 const declarations=text.slice(text.indexOf("const outcomes ="),text.indexOf("export const GOVERNANCE_AUDIT_ACTIONS"));
 const unavailable=text.split(/\r?\n/u).find(line=>line.startsWith("const unavailable ="));
 const functions=text.slice(text.indexOf("export function safeGovernanceAuditText"),text.indexOf("async function searchPredicate")).replaceAll("export function","function");
 const input=`const uuid=z.string().uuid();\n${declarations}\n${unavailable}\n${functions}\nreturn {projectGovernanceAuditEvent,safeGovernanceAuditText};`;
 const compiled=ts.transpileModule(input,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 return new Function("z",compiled)(z);
}
const old=projector(source),candidate=projector(updated);
const live=JSON.parse(await readFile(path.join(own,"DEV-ACTUAL-WORKFLOW-20261004.json"),"utf8"));assert.equal(live.audit.length,8);
const checks=[];
for(const row of live.audit){
 const a=old.projectGovernanceAuditEvent(row),b=candidate.projectGovernanceAuditEvent(row);
 assert.equal(a.actor_name,null);assert.equal(b.actor_name,row.actor_user_id);
 assert.deepEqual({...b,actor_name:null},a);
 checks.push({event_id:String(row.id),actor_uuid_fallback:true,all_other_fields_unchanged:true});
}
const row=live.audit.find(r=>r.actor_user_id==="d32d7db7-1550-4405-a1f3-9dd2c661711e");assert.ok(row);
const labels=new Map([[row.actor_user_id,"FVI QA Access DEV checker"]]);
assert.equal(candidate.projectGovernanceAuditEvent(row,labels).actor_name,"FVI QA Access DEV checker");checks.push({case:"authorized profile name retains priority",pass:true});
assert.equal(candidate.projectGovernanceAuditEvent({...row,actor_user_id:null}).actor_name,null);checks.push({case:"unknown historical actor remains unknown",pass:true});
assert.throws(()=>candidate.projectGovernanceAuditEvent({...row,id:Number.MAX_SAFE_INTEGER+1}),/temporarily unavailable/u);checks.push({case:"unsafe audit identifier still fails closed",pass:true});
assert.equal(candidate.projectGovernanceAuditEvent({...row,context:{...row.context,reason:"Bearer synthetic-negative-fixture"}}).reason,"[redacted]");checks.push({case:"reason secret redaction unchanged",pass:true});
const sha=s=>createHash("sha256").update(s).digest("hex");
const file=path.join(own,"GOVERNANCE-AUDIT-ACTOR-UUID-FALLBACK-20261004-v2.patch");
const patch=`diff --git a/${relative} b/${relative}\n--- a/${relative}\n+++ b/${relative}\n@@ -70,6 +70,6 @@\n     id: String(row.id), occurred_at: row.occurred_at, scope: row.scope, action: row.action,\n     actor_user_id: row.actor_user_id,\n-${before}\n+${after}\n     actor_role: safeGovernanceAuditText(context.actor_role), team_name: safeGovernanceAuditText(context.team_name),\n     scope_label: safeGovernanceAuditText(context.scope_label) ?? (["tenant", "workspace", "platform", "api", "system"].includes(row.scope) ? row.scope : "unknown"),\n     environment: typeof context.environment === "string" && ["prod", "dev", "sandbox", "uat", "development", "staging", "production"].includes(context.environment) ? context.environment : null,\n`;
await writeFile(file,patch,{flag:"wx"});
execFileSync("git",["apply","--check",file],{stdio:"pipe"});
assert.equal(await readFile(relative,"utf8"),source,"Shared source must remain unchanged");
const proof={at:new Date().toISOString(),status:"SOURCE-PROPOSAL-PASS-NOT-INTEGRATED-OR-LIVE",file,source_file:relative,preimage_sha256:sha(source),postimage_sha256:sha(updated),patch_sha256:sha(patch),focused_checks:checks,git_apply_check:true,source_unchanged:true,scope:"Only display/export scalar fallback to the already-authorized actual actor UUID. Ordinary profiles RLS and native caller authorization remain exact. Pure projection checks are local, not an assertion of hosted label correction."};
const evidence=path.join(own,"GOVERNANCE-AUDIT-ACTOR-UUID-FALLBACK-20261004-v2.json");await writeFile(evidence,JSON.stringify(proof,null,2),{flag:"wx"});console.log(JSON.stringify({status:proof.status,focused_checks:checks.length,git_apply_check:true,source_unchanged:true,patch:file,evidence}));
