import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const targetName = process.env.FVI_RECON_IDENTIFIER_TARGET ?? "";
const projectRef = { prod: "YOUR_PROJECT_REF", dev: "YOUR_PROJECT_REF" }[targetName];
if (!projectRef) throw new Error("FVI_RECON_IDENTIFIER_TARGET must be prod or dev");
if (process.env.FVI_ALLOW_RECON_IDENTIFIER_MIGRATION !== "YES") {
  throw new Error("Set FVI_ALLOW_RECON_IDENTIFIER_MIGRATION=YES");
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
if (!/^sbp_[A-Za-z0-9_-]{20,}$/u.test(accessToken)) throw new Error("Management API token is unavailable");

const version = "20260914110000";
const name = "add_reconciliation_identifiers";
const migration = await readFile(path.resolve(`supabase/migrations/${version}_${name}.sql`), "utf8");
const sha256 = createHash("sha256").update(migration).digest("hex");
const effectSql = `select
  exists(select 1 from supabase_migrations.schema_migrations where version='${version}') as ledgered,
  (select count(*)::integer from supabase_migrations.schema_migrations) as ledger_count,
  (select count(*)::integer from public.recon_definitions) as definitions,
  (select count(*)::integer from public.recon_definitions where recon_code is null) as null_codes,
  (select count(*)::integer from public.recon_definitions where recon_code !~ '^FVI-[A-Z0-9]{2,12}-(1WAY|2WAY|3WAY)-[0-9]{6,}$') as invalid_codes,
  (select count(*)::integer from (select tenant_id,recon_code from public.recon_definitions group by tenant_id,recon_code having count(*) > 1) duplicates) as duplicate_codes,
  exists(select 1 from pg_constraint where conname='recon_definitions_recon_code_check') as format_constraint,
  exists(select 1 from pg_indexes where schemaname='public' and indexname='recon_definitions_tenant_recon_code_uidx') as unique_index,
  to_regprocedure('public.assign_reconciliation_code()') is not null as assign_function,
  to_regprocedure('public.prevent_reconciliation_identity_change()') is not null as immutable_function,
  exists(select 1 from pg_trigger where tgname='trg_assign_reconciliation_code' and not tgisinternal) as assign_trigger,
  exists(select 1 from pg_trigger where tgname='trg_prevent_reconciliation_identity_change' and not tgisinternal) as immutable_trigger,
  (select count(*)::integer from public.audit_log where action='recon.identifier.backfilled') as backfill_audits`;

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
  return row.null_codes === 0
    && row.invalid_codes === 0
    && row.duplicate_codes === 0
    && row.format_constraint === true
    && row.unique_index === true
    && row.assign_function === true
    && row.immutable_function === true
    && row.assign_trigger === true
    && row.immutable_trigger === true
    && row.backfill_audits === row.definitions;
}

let before;
try {
  before = (await query(effectSql, true))[0];
} catch (error) {
  if (!/recon_code/u.test(String(error))) throw error;
  before = { ledgered: false };
}

if (before.ledgered) {
  if (!effectsComplete(before)) throw new Error("Reconciliation identifier migration is ledgered but incomplete");
  console.log(JSON.stringify({ ok: true, target: targetName, version, sha256, reused: true, ledger_count: before.ledger_count, definitions: before.definitions }));
} else {
  const marker = `Applied by FVI controlled Management API; sha256=${sha256}`;
  await query(`begin;\n${migration}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values ('${version}','${name}',array['${marker}']);\ncommit;`, false);
  const after = (await query(effectSql, true))[0];
  if (!after.ledgered || !effectsComplete(after)) throw new Error("Reconciliation identifier migration readback failed");
  console.log(JSON.stringify({ ok: true, target: targetName, version, sha256, reused: false, ledger_count: after.ledger_count, definitions: after.definitions, backfill_audits: after.backfill_audits }));
}
