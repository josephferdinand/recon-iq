import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const targetName = process.env.FVI_ENV_CHANGE_TARGET ?? "";
const targets = { prod: "YOUR_PROJECT_REF", dev: "YOUR_PROJECT_REF" };
const projectRef = targets[targetName];
if (!projectRef) throw new Error("FVI_ENV_CHANGE_TARGET must be prod or dev");
if (process.env.FVI_ALLOW_ENV_CHANGE_MIGRATION !== "YES") {
  throw new Error("Set FVI_ALLOW_ENV_CHANGE_MIGRATION=YES");
}
if (targetName === "dev" && process.env.FVI_ALLOW_DEV_REPLICATION !== "YES") {
  throw new Error("DEV replication requires FVI_ALLOW_DEV_REPLICATION=YES after PROD acceptance");
}
const vaultPath = process.env.FVI_VAULT_PATH ?? "";
const patFile = process.env.FVI_SUPABASE_PAT_FILE ?? "";
if (
  !patFile &&
  (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md")
) {
  throw new Error("Set the canonical FVI_VAULT_PATH or protected FVI_SUPABASE_PAT_FILE");
}
if (patFile && !path.isAbsolute(patFile)) {
  throw new Error("FVI_SUPABASE_PAT_FILE must be an absolute protected file");
}

function tableValue(markdown, key) {
  const start = markdown.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
  const end = markdown.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
  if (start >= 0 && end > start) {
    const line = markdown
      .slice(start, end)
      .split(/\r?\n/u)
      .find((candidate) => candidate.startsWith(`| \`${key}\` |`));
    const value = line?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
    if (value) return value;
  }
  const marker = `\`${key}\``;
  const line = markdown
    .split(/\r?\n/u)
    .find((candidate) => candidate.startsWith("|") && candidate.includes(marker));
  if (!line) throw new Error(`Missing vault field ${key}`);
  const cells = line.split("|").map((cell) => cell.trim());
  const value = cells
    .slice(2)
    .map((cell) => cell.replace(/^`|`$/gu, "").replace(/^<|>$/gu, "").replace(/\s+/gu, ""))
    .find((candidate) => /^sbp_[A-Za-z0-9_-]{20,}$/u.test(candidate));
  if (!value) throw new Error(`Vault field ${key} is not populated`);
  return value;
}

const accessToken = patFile
  ? (await readFile(patFile, "utf8")).trim()
  : tableValue(await readFile(vaultPath, "utf8"), "SUPABASE_ACCESS_TOKEN");
if (!/^sbp_[A-Za-z0-9_-]{20,}$/u.test(accessToken)) {
  throw new Error("Protected Management API token is unavailable");
}

const version = "20260909022500";
const name = "bind_environment_packages_to_tenant_family";
const migration = await readFile(
  path.resolve("supabase/migrations/20260909022500_bind_environment_packages_to_tenant_family.sql"),
  "utf8",
);
const sha256 = createHash("sha256").update(migration).digest("hex");
const effectSql = `select
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='tenant_families' and column_name='release_identity_uid') as release_identity,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='tenant_families' and column_name='verified_organization_domain') as verified_domain,
  to_regprocedure('public.environment_tenant_identity(uuid)') is not null as identity_function,
  to_regprocedure('public.receive_environment_change_unbound_for_api(jsonb,text)') is not null as guarded_receiver,
  to_regprocedure('public.record_environment_package_rejection_for_api(uuid,uuid,jsonb)') is not null as rejection_function,
  exists(select 1 from pg_trigger where tgname='guard_environment_tenant_identity' and not tgisinternal) as identity_guard,
  coalesce(not has_function_privilege('authenticated',to_regprocedure('public.record_environment_package_rejection_for_api(uuid,uuid,jsonb)'),'EXECUTE'),false) as rejection_user_denied,
  coalesce(has_function_privilege('service_role',to_regprocedure('public.record_environment_package_rejection_for_api(uuid,uuid,jsonb)'),'EXECUTE'),false) as rejection_service_allowed,
  exists(select 1 from supabase_migrations.schema_migrations where version='${version}') as ledgered,
  (select count(*)::integer from supabase_migrations.schema_migrations) as ledger_count`;
const effectKeys = [
  "release_identity",
  "verified_domain",
  "identity_function",
  "guarded_receiver",
  "rejection_function",
  "identity_guard",
  "rejection_user_denied",
  "rejection_service_allowed",
];

async function query(sql, readOnly) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ query: sql, read_only: readOnly }),
    },
  );
  const raw = await response.text();
  if (!response.ok) {
    let detail = "query_rejected";
    try {
      const parsed = JSON.parse(raw);
      detail = String(parsed.message ?? parsed.error ?? detail).slice(0, 500);
    } catch {
      // Preserve a stable non-sensitive fallback.
    }
    throw new Error(`Supabase Management API query failed with HTTP ${response.status}: ${detail}`);
  }
  return JSON.parse(raw);
}

const before = (await query(effectSql, true))[0];
const effects = effectKeys.map((key) => Boolean(before[key]));
if (before.ledgered) {
  if (effects.some((value) => !value)) {
    throw new Error("Tenant-family binding is ledgered but effects are incomplete");
  }
  console.log(
    JSON.stringify({
      ok: true,
      target: targetName,
      version,
      sha256,
      reused: true,
      ledger_count: before.ledger_count,
    }),
  );
} else {
  if (effects.some(Boolean))
    throw new Error("Tenant-family binding effects exist without ledger evidence");
  const marker = `Applied by FVI controlled Management API; sha256=${sha256}`.replaceAll("'", "''");
  await query(
    `begin;\n${migration}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values ('${version}','${name}',array['${marker}']);\ncommit;`,
    false,
  );
  const after = (await query(effectSql, true))[0];
  if (!after.ledgered || effectKeys.some((key) => !after[key])) {
    throw new Error("Tenant-family binding readback failed");
  }
  console.log(
    JSON.stringify({
      ok: true,
      target: targetName,
      version,
      sha256,
      reused: false,
      ledger_count: after.ledger_count,
    }),
  );
}
