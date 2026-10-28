import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const targetName = process.env.FVI_CONNECTOR_AGENT_TARGET ?? "";
const targets = {
  prod: { ref: "YOUR_PROJECT_REF" },
  dev: { ref: "YOUR_PROJECT_REF" },
};
const target = targets[targetName];
if (!target) throw new Error("FVI_CONNECTOR_AGENT_TARGET must be prod or dev");
if (process.env.FVI_ALLOW_CONNECTOR_AGENT_MIGRATION !== "YES")
  throw new Error("Set FVI_ALLOW_CONNECTOR_AGENT_MIGRATION=YES");
if (targetName === "dev" && process.env.FVI_ALLOW_DEV_REPLICATION !== "YES")
  throw new Error("DEV replication requires FVI_ALLOW_DEV_REPLICATION=YES after PROD acceptance");

const vaultPath = process.env.FVI_VAULT_PATH ?? "";
const patFile = process.env.FVI_SUPABASE_PAT_FILE ?? "";
if (!patFile && (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md"))
  throw new Error("Set the canonical FVI_VAULT_PATH or protected FVI_SUPABASE_PAT_FILE");
if (patFile && !path.isAbsolute(patFile)) throw new Error("FVI_SUPABASE_PAT_FILE must be absolute");

function tableValue(markdown, key) {
  const marker = `\`${key}\``;
  const line = markdown.split(/\r?\n/u).find((candidate) => candidate.startsWith("|") && candidate.includes(marker));
  if (!line) throw new Error(`Missing vault field ${key}`);
  const cells = line.split("|").map((cell) => cell.trim());
  const candidates = cells.slice(2).map((cell) => cell.replace(/^`|`$/gu, "").replace(/^<|>$/gu, ""));
  const value = candidates.find((candidate) => /^sbp_[A-Za-z0-9_-]{20,}$/u.test(candidate));
  if (!value) throw new Error(`Vault field ${key} is not populated with a Management API token`);
  return value;
}

const accessToken = patFile
  ? (await readFile(patFile, "utf8")).trim()
  : tableValue(await readFile(vaultPath, "utf8"), "SUPABASE_ACCESS_TOKEN");
if (!/^sbp_[A-Za-z0-9_-]{20,}$/u.test(accessToken))
  throw new Error("Protected Management API token is unavailable");
const migrationPath = path.resolve("supabase/migrations/20260906014500_add_connector_agent_queue.sql");
const migration = await readFile(migrationPath, "utf8");
const sha256 = createHash("sha256").update(migration).digest("hex");
const version = "20260906014500";

async function query(sql, readOnly) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${target.ref}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
  });
  if (!response.ok) throw new Error(`Supabase Management API query failed with HTTP ${response.status}`);
  return response.json();
}

const effectSql = `
select
  (select count(*) = 3 from information_schema.columns
    where table_schema = 'public' and table_name = 'workflow_api_jobs'
      and column_name in ('lease_token_id','lease_agent_id','lease_expires_at')) as has_lease_columns,
  to_regprocedure('public.claim_connector_agent_job(uuid,uuid,text,integer)') is not null as has_claim,
  to_regprocedure('public.complete_connector_agent_job(uuid,uuid,text,uuid,jsonb,jsonb,text,text,bigint)') is not null as has_complete,
  to_regprocedure('public.fail_connector_agent_job(uuid,uuid,text,uuid,text)') is not null as has_fail,
  exists(select 1 from pg_constraint where conrelid = 'public.workflow_api_jobs'::regclass
    and conname = 'workflow_api_jobs_job_kind_check'
    and pg_get_constraintdef(oid) like '%connector_agent_run%') as has_job_kind,
  exists(select 1 from supabase_migrations.schema_migrations where version = '${version}') as ledgered,
  (select count(*)::integer from supabase_migrations.schema_migrations) as ledger_count
`;

const before = (await query(effectSql, true))[0];
const effects = [before.has_lease_columns, before.has_claim, before.has_complete, before.has_fail, before.has_job_kind];
if (before.ledgered) {
  if (effects.some((value) => !value)) throw new Error("Connector-agent migration is ledgered but effects are incomplete");
  console.log(JSON.stringify({ ok: true, target: targetName, version, sha256, reused: true, ledger_count: before.ledger_count }));
  process.exit(0);
}
if (effects.some(Boolean)) throw new Error("Connector-agent effects exist without ledger evidence; refusing automatic repair");

const marker = `Applied by FVI controlled Management API; sha256=${sha256}`.replaceAll("'", "''");
await query(`begin;\n${migration}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values ('${version}','add_connector_agent_queue',array['${marker}']);\ncommit;`, false);
const after = (await query(effectSql, true))[0];
if (!after.ledgered || [after.has_lease_columns, after.has_claim, after.has_complete, after.has_fail, after.has_job_kind].some((value) => !value))
  throw new Error("Connector-agent migration readback failed");
console.log(JSON.stringify({ ok: true, target: targetName, version, sha256, reused: false, ledger_count: after.ledger_count }));
