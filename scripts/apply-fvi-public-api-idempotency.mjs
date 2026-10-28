import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const targetName = process.env.FVI_PUBLIC_API_TARGET ?? "";
const targets = {
  prod: { ref: "YOUR_PROJECT_REF" },
  dev: { ref: "YOUR_PROJECT_REF" },
};
const target = targets[targetName];
if (!target) throw new Error("FVI_PUBLIC_API_TARGET must be prod or dev");
if (process.env.FVI_ALLOW_PUBLIC_API_MIGRATION !== "YES") {
  throw new Error("Set FVI_ALLOW_PUBLIC_API_MIGRATION=YES");
}

const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("FVI_VAULT_PATH must identify the canonical secured vault file");
}

function tableValue(markdown, key) {
  const marker = `\`${key}\``;
  const line = markdown.split(/\r?\n/u).find((candidate) => candidate.startsWith("|") && candidate.includes(marker));
  if (!line) throw new Error(`Missing vault field ${key}`);
  const cells = line.split("|").map((cell) => cell.trim());
  const value = cells[2]?.replace(/^`|`$/gu, "").replace(/^<|>$/gu, "");
  if (!value || /pending/iu.test(value)) throw new Error(`Vault field ${key} is not populated`);
  return value;
}

const vault = await readFile(vaultPath, "utf8");
const accessToken = tableValue(vault, "SUPABASE_ACCESS_TOKEN");
if (!/^sbp_[A-Za-z0-9_-]{20,}$/u.test(accessToken)) {
  throw new Error("SUPABASE_ACCESS_TOKEN is not populated with a usable Management API token");
}
const migrationPath = path.resolve("supabase/migrations/20260905181500_create_public_api_idempotency.sql");
const migration = await readFile(migrationPath, "utf8");
const sha256 = createHash("sha256").update(migration).digest("hex");
const version = "20260905181500";

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
  to_regclass('public.public_api_idempotency') is not null as has_table,
  to_regprocedure('public.claim_public_api_idempotency(uuid,uuid,text,text,text)') is not null as has_claim,
  to_regprocedure('public.complete_public_api_idempotency(uuid,uuid,text,text,text,integer,jsonb)') is not null as has_complete,
  exists(select 1 from supabase_migrations.schema_migrations where version = '${version}') as ledgered,
  (select count(*)::integer from supabase_migrations.schema_migrations) as ledger_count
`;
const before = (await query(effectSql, true))[0];
if (before.ledgered) {
  if (!before.has_table || !before.has_claim || !before.has_complete) {
    throw new Error("Migration is ledgered but its live effects are incomplete");
  }
  console.log(JSON.stringify({ ok: true, target: targetName, version, sha256, reused: true, ledger_count: before.ledger_count }));
  process.exit(0);
}
if (before.has_table || before.has_claim || before.has_complete) {
  throw new Error("Migration effects exist without ledger evidence; refusing automatic repair");
}

const statementMarker = `Applied by FVI controlled Management API; sha256=${sha256}`.replaceAll("'", "''");
await query(`begin;\n${migration}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values ('${version}','create_public_api_idempotency',array['${statementMarker}']);\ncommit;`, false);
const after = (await query(effectSql, true))[0];
if (!after.ledgered || !after.has_table || !after.has_claim || !after.has_complete) {
  throw new Error("Migration readback failed");
}
console.log(JSON.stringify({ ok: true, target: targetName, version, sha256, reused: false, ledger_count: after.ledger_count }));
