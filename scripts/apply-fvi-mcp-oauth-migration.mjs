import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const targetName = process.env.FVI_MCP_OAUTH_TARGET ?? "";
const projectRef = { prod: "YOUR_PROJECT_REF", dev: "YOUR_PROJECT_REF" }[targetName];
if (!projectRef) throw new Error("FVI_MCP_OAUTH_TARGET must be prod or dev");
if (process.env.FVI_ALLOW_MCP_OAUTH_MIGRATION !== "YES") throw new Error("Set FVI_ALLOW_MCP_OAUTH_MIGRATION=YES");
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

const version = "20260909070000";
const name = "create_mcp_oauth_authorization_server";
const migration = await readFile(path.resolve(`supabase/migrations/${version}_${name}.sql`), "utf8");
const sha256 = createHash("sha256").update(migration).digest("hex");
const effectSql = `select
  to_regclass('public.mcp_oauth_clients') is not null as clients,
  to_regclass('public.mcp_oauth_authorization_codes') is not null as codes,
  to_regclass('public.mcp_oauth_refresh_tokens') is not null as refresh_tokens,
  to_regprocedure('public.exchange_mcp_oauth_code(text,text,text,text,text,text,text,timestamptz,timestamptz)') is not null as exchange_fn,
  to_regprocedure('public.rotate_mcp_oauth_refresh_token(text,text,text,text,text,timestamptz,timestamptz)') is not null as refresh_fn,
  coalesce(not has_table_privilege('authenticated',to_regclass('public.mcp_oauth_clients'),'SELECT'),false) as authenticated_denied,
  coalesce(has_function_privilege('service_role',to_regprocedure('public.exchange_mcp_oauth_code(text,text,text,text,text,text,text,timestamptz,timestamptz)'),'EXECUTE'),false) as exchange_service_allowed,
  exists(select 1 from supabase_migrations.schema_migrations where version='${version}') as ledgered,
  (select count(*)::integer from supabase_migrations.schema_migrations) as ledger_count`;
const effectKeys = ["clients", "codes", "refresh_tokens", "exchange_fn", "refresh_fn", "authenticated_denied", "exchange_service_allowed"];

async function query(sql, readOnly) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
  });
  const raw = await response.text();
  if (!response.ok) {
    let detail = "query_rejected";
    try { const parsed = JSON.parse(raw); detail = String(parsed.message ?? parsed.error ?? detail).slice(0, 500); } catch { /* stable fallback */ }
    throw new Error(`Supabase Management API query failed with HTTP ${response.status}: ${detail}`);
  }
  return JSON.parse(raw);
}

const before = (await query(effectSql, true))[0];
if (before.ledgered) {
  if (effectKeys.some((key) => !before[key])) throw new Error("MCP OAuth migration is ledgered but effects are incomplete");
  console.log(JSON.stringify({ ok: true, target: targetName, version, sha256, reused: true, ledger_count: before.ledger_count }));
} else {
  if (effectKeys.some((key) => before[key])) throw new Error("MCP OAuth effects exist without ledger evidence");
  const marker = `Applied by FVI controlled Management API; sha256=${sha256}`;
  await query(`begin;\n${migration}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values ('${version}','${name}',array['${marker}']);\ncommit;`, false);
  const after = (await query(effectSql, true))[0];
  if (!after.ledgered || effectKeys.some((key) => !after[key])) throw new Error("MCP OAuth migration readback failed");
  console.log(JSON.stringify({ ok: true, target: targetName, version, sha256, reused: false, ledger_count: after.ledger_count }));
}
