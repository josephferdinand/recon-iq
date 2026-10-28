import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const targetName = process.env.FVI_RECON_ORCHESTRATOR_TARGET ?? "";
const projectRef = { prod: "YOUR_PROJECT_REF", dev: "YOUR_PROJECT_REF" }[targetName];
if (!projectRef) throw new Error("FVI_RECON_ORCHESTRATOR_TARGET must be prod or dev");
if (process.env.FVI_ALLOW_RECON_ORCHESTRATOR_MIGRATION !== "YES") {
  throw new Error("Set FVI_ALLOW_RECON_ORCHESTRATOR_MIGRATION=YES");
}
if (targetName === "dev" && process.env.FVI_ALLOW_DEV_REPLICATION !== "YES") {
  throw new Error("DEV replication requires FVI_ALLOW_DEV_REPLICATION=YES after PROD proof");
}

const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Set FVI_VAULT_PATH to the canonical secured vault");
}

function vaultValue(markdown, key) {
  const start = markdown.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
  const end = markdown.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
  const line = markdown.slice(start, end).split(/\r?\n/u)
    .find((candidate) => candidate.startsWith(`| \`${key}\` |`));
  const value = line?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
  if (!value) throw new Error(`Missing vault field ${key}`);
  return value;
}

const accessToken = vaultValue(await readFile(vaultPath, "utf8"), "SUPABASE_ACCESS_TOKEN");
const version = "20260914190000";
const name = "harden_recon_orchestrator";
const migration = await readFile(path.resolve(`supabase/migrations/${version}_${name}.sql`), "utf8");
const sha256 = createHash("sha256").update(migration).digest("hex");
const effectSql = `select
  exists(select 1 from supabase_migrations.schema_migrations where version='${version}') as ledgered,
  (select count(*)::integer from supabase_migrations.schema_migrations) as ledger_count,
  to_regprocedure('public.claim_recon_schedule_run(uuid,text,timestamptz,text,integer,uuid,bigint)') is not null as claim_fn,
  to_regprocedure('public.finish_recon_schedule_run(bigint,text,uuid,integer,integer,integer,text,jsonb)') is not null as finish_fn,
  exists(select 1 from pg_indexes where schemaname='public' and indexname='recon_schedule_runs_occurrence_attempt_uq') as occurrence_uq,
  exists(select 1 from pg_indexes where schemaname='public' and indexname='recon_schedule_runs_one_running_uq') as one_running_uq,
  not has_table_privilege('authenticated','public.recon_schedule_runs','INSERT') as direct_insert_denied,
  not has_function_privilege('authenticated',to_regprocedure('public.claim_recon_schedule_run(uuid,text,timestamptz,text,integer,uuid,bigint)'),'EXECUTE') as auth_claim_denied,
  has_function_privilege('service_role',to_regprocedure('public.claim_recon_schedule_run(uuid,text,timestamptz,text,integer,uuid,bigint)'),'EXECUTE') as service_claim_allowed,
  (select count(*)::integer from information_schema.columns where table_schema='public' and table_name='recon_schedule_runs'
    and column_name in ('scheduled_for','occurrence_key','attempt','max_attempts','retry_after','retry_claimed_at','superseded_by_id','actor_user_id','lease_expires_at')) as run_columns,
  (select count(*)::integer from information_schema.columns where table_schema='public' and table_name='recon_schedules'
    and column_name in ('max_attempts','retry_backoff_seconds','catch_up_window_minutes','last_dispatched_for')) as schedule_columns,
  (select count(*)::integer from public.recon_schedule_runs where scheduled_for is null or occurrence_key is null) as invalid_runs,
  (select count(*)::integer from (select schedule_id from public.recon_schedule_runs where status='running' group by schedule_id having count(*) > 1) x) as overlapping_runs`;

async function query(sql, readOnly) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
  });
  const raw = await response.text();
  if (!response.ok) {
    let detail = "query_rejected";
    try {
      const parsed = JSON.parse(raw);
      detail = String(parsed.message ?? parsed.error ?? detail).slice(0, 500);
    } catch { /* stable fallback */ }
    throw new Error(`Supabase Management API query failed with HTTP ${response.status}: ${detail}`);
  }
  return JSON.parse(raw);
}

function effectsComplete(row) {
  return row.claim_fn === true
    && row.finish_fn === true
    && row.occurrence_uq === true
    && row.one_running_uq === true
    && row.direct_insert_denied === true
    && row.auth_claim_denied === true
    && row.service_claim_allowed === true
    && row.run_columns === 9
    && row.schedule_columns === 4
    && row.invalid_runs === 0
    && row.overlapping_runs === 0;
}

let before;
try {
  before = (await query(effectSql, true))[0];
} catch (error) {
  if (!/scheduled_for|claim_recon_schedule_run|last_dispatched_for/u.test(String(error))) throw error;
  before = { ledgered: false };
}

if (before.ledgered) {
  if (!effectsComplete(before)) throw new Error("Recon Orchestrator migration is ledgered but incomplete");
  console.log(JSON.stringify({ ok: true, target: targetName, version, sha256, reused: true, ledger_count: before.ledger_count }));
} else {
  const marker = `Applied by FVI controlled Management API; sha256=${sha256}`;
  await query(`begin;\n${migration}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values ('${version}','${name}',array['${marker}']);\ncommit;`, false);
  const after = (await query(effectSql, true))[0];
  if (!after.ledgered || !effectsComplete(after)) throw new Error("Recon Orchestrator migration readback failed");
  console.log(JSON.stringify({
    ok: true,
    target: targetName,
    version,
    sha256,
    reused: false,
    ledger_count: after.ledger_count,
    direct_insert_denied: true,
    overlapping_runs: after.overlapping_runs,
  }));
}
