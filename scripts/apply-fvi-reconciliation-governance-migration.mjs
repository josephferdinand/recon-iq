import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const targetName = process.env.FVI_RECON_GOVERNANCE_TARGET ?? "";
const projectRef = { prod: "YOUR_PROJECT_REF", dev: "YOUR_PROJECT_REF" }[targetName];
if (!projectRef) throw new Error("FVI_RECON_GOVERNANCE_TARGET must be prod or dev");
if (process.env.FVI_ALLOW_RECON_GOVERNANCE_MIGRATION !== "YES") throw new Error("Set FVI_ALLOW_RECON_GOVERNANCE_MIGRATION=YES");
if (targetName === "dev" && process.env.FVI_ALLOW_DEV_REPLICATION !== "YES") throw new Error("DEV replication requires FVI_ALLOW_DEV_REPLICATION=YES after PROD proof");
const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") throw new Error("Set FVI_VAULT_PATH to the canonical secured vault");

function vaultValue(markdown, key) {
  const start = markdown.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
  const end = markdown.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
  const line = markdown.slice(start, end).split(/\r?\n/u).find((candidate) => candidate.startsWith(`| \`${key}\` |`));
  const value = line?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
  if (!value) throw new Error(`Missing vault field ${key}`);
  return value;
}
const accessToken = vaultValue(await readFile(vaultPath, "utf8"), "SUPABASE_ACCESS_TOKEN");
const version = "20260914170000";
const name = "harden_reconciliation_review_and_assignment";
const migration = await readFile(path.resolve(`supabase/migrations/${version}_${name}.sql`), "utf8");
const sha256 = createHash("sha256").update(migration).digest("hex");
const effectSql = `select
  exists(select 1 from supabase_migrations.schema_migrations where version='${version}') as ledgered,
  (select count(*)::integer from supabase_migrations.schema_migrations) as ledger_count,
  to_regprocedure('public.assign_exceptions_from_rule(uuid,uuid,uuid[])') is not null as assignment_fn,
  to_regprocedure('public.review_proposed_match_atomic(uuid,uuid,text,text)') is not null as proposed_fn,
  to_regprocedure('public.review_proposed_matches_atomic(uuid,uuid[],text)') is not null as proposed_bulk_fn,
  to_regprocedure('public.decide_manual_match_atomic(uuid,uuid,text,text)') is not null as manual_fn,
  not has_table_privilege('authenticated','public.proposed_matches','UPDATE') as proposed_direct_denied,
  not has_table_privilege('authenticated','public.manual_match_approvals','UPDATE') as manual_direct_denied,
  has_function_privilege('authenticated',to_regprocedure('public.assign_exceptions_from_rule(uuid,uuid,uuid[])'),'EXECUTE') as assignment_allowed,
  has_function_privilege('authenticated',to_regprocedure('public.review_proposed_match_atomic(uuid,uuid,text,text)'),'EXECUTE') as proposed_allowed,
  has_function_privilege('authenticated',to_regprocedure('public.decide_manual_match_atomic(uuid,uuid,text,text)'),'EXECUTE') as manual_allowed`;

async function query(sql, readOnly) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
  });
  const raw = await response.text();
  if (!response.ok) {
    let detail = "query_rejected";
    try { const parsed = JSON.parse(raw); detail = String(parsed.message ?? parsed.error ?? detail).slice(0,500); } catch { /* fallback */ }
    throw new Error(`Supabase Management API query failed with HTTP ${response.status}: ${detail}`);
  }
  return JSON.parse(raw);
}
function complete(row) {
  return ["assignment_fn","proposed_fn","proposed_bulk_fn","manual_fn","proposed_direct_denied","manual_direct_denied","assignment_allowed","proposed_allowed","manual_allowed"].every((key) => row[key] === true);
}
let before;
try { before = (await query(effectSql,true))[0]; } catch (error) {
  if (!/assign_exceptions_from_rule|review_proposed_match_atomic|decide_manual_match_atomic/u.test(String(error))) throw error;
  before = { ledgered: false };
}
if (before.ledgered) {
  if (!complete(before)) throw new Error("Governance migration is ledgered but incomplete");
  console.log(JSON.stringify({ok:true,target:targetName,version,sha256,reused:true,ledger_count:before.ledger_count}));
} else {
  const marker = `Applied by FVI controlled Management API; sha256=${sha256}`;
  await query(`begin;\n${migration}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values ('${version}','${name}',array['${marker}']);\ncommit;`,false);
  const after = (await query(effectSql,true))[0];
  if (!after.ledgered || !complete(after)) throw new Error("Governance migration readback failed");
  console.log(JSON.stringify({ok:true,target:targetName,version,sha256,reused:false,ledger_count:after.ledger_count,direct_updates_denied:true}));
}
