import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = "20260923090300";
export const NAME = "vault_active_tenant_boundary";
export const PROJECT_REF = "YOUR_PROJECT_REF";
export const SOURCE_SHA256 = "9df00de744c70959561e4abc6f40bce08252220d81aed2375363bf1a0ba2e997";
const PREDECESSOR = "20260923090200";
const TABLES = ["app_vault_secrets", "app_vault_kms_bindings", "app_vault_rotation_log", "app_vault_secret_versions"];
const BOUNDARIES = [
  ["app_vault_secrets", "app_vault_active_tenant_boundary"],
  ["app_vault_kms_bindings", "app_vault_kms_active_tenant_boundary"],
  ["app_vault_rotation_log", "app_vault_rotation_active_tenant_boundary"],
  ["app_vault_secret_versions", "app_vault_versions_active_tenant_boundary"],
];
const ORIGINAL_NAMES = [
  ["app_vault_secrets", "app_vault_platform_admin_all", "ALL"],
  ["app_vault_secrets", "app_vault_tenant_admin_all", "ALL"],
  ["app_vault_kms_bindings", "kms_bind_platform_all", "ALL"],
  ["app_vault_kms_bindings", "kms_bind_tenant_all", "ALL"],
  ["app_vault_rotation_log", "app_vault_rot_read", "SELECT"],
  ["app_vault_rotation_log", "app_vault_rot_insert", "INSERT"],
  ["app_vault_secret_versions", "app_vault_ver_read", "SELECT"],
  ["app_vault_secret_versions", "app_vault_ver_insert", "INSERT"],
];
// Digest is taken from the disposable PG15 replay of the 342 exact ordered
// predecessors. It covers all eight original policy bodies, not only names.
const ORIGINAL_CATALOGUE_MD5 = "4b37be244a4197346247daa8a08fa17a";
const INSTALLED_CATALOGUE_MD5 = "6f068d117d414a4a9248c9063240ae45";
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const tableList = TABLES.map(literal).join(",");
const policySql = `select coalesce(jsonb_agg(jsonb_build_object(
  'table',tablename,'name',policyname,'cmd',cmd,'roles',roles,
  'permissive',permissive,'qual',qual,'check',with_check)
  order by tablename,policyname),'[]'::jsonb)
  from pg_policies where schemaname='public' and tablename in (${tableList})`;
const originalPolicySql = `select coalesce(jsonb_agg(jsonb_build_object(
  'table',tablename,'name',policyname,'cmd',cmd,'roles',roles,
  'permissive',permissive,'qual',qual,'check',with_check)
  order by tablename,policyname),'[]'::jsonb)
  from pg_policies where schemaname='public' and tablename in (${tableList})
    and policyname not in (${BOUNDARIES.map(([, name]) => literal(name)).join(",")})`;
const catalogueMd5Sql = `md5((${policySql})::text)`;
const originalsMd5Sql = `md5((${originalPolicySql})::text)`;
export const STATE_SQL = `select jsonb_build_object(
  'latest',(select max(version::text) from supabase_migrations.schema_migrations),
  'ledger',(select jsonb_build_object('name',name,'statements',statements)
    from supabase_migrations.schema_migrations where version::text='${VERSION}'),
  'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,
    'auth_select',has_table_privilege('authenticated',c.oid,'SELECT'),
    'auth_insert',has_table_privilege('authenticated',c.oid,'INSERT'),
    'service_select',has_table_privilege('service_role',c.oid,'SELECT')) order by c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in (${tableList}) and c.relkind in ('r','p')),
  'policies',(${policySql}),
  'catalogue_md5',${catalogueMd5Sql},
  'originals_md5',${originalsMd5Sql},
  'tenant_active_column',exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='tenant_members' and column_name='active'),
  'service_bypass',(select rolbypassrls from pg_roles where rolname='service_role')
) as state`;

export function assessState(state, backupFresh) {
  if (!state || !backupFresh || !state.tenant_active_column || !state.service_bypass
    || !Array.isArray(state.tables) || state.tables.length !== 4
    || !TABLES.every((table) => state.tables.some((row) => row.name === table && row.rls
      && row.auth_select && row.auth_insert && row.service_select))
    || !Array.isArray(state.policies) || state.originals_md5 !== ORIGINAL_CATALOGUE_MD5) {
    throw new Error("Vault table/RLS/privilege/original-policy/backup prerequisites failed");
  }
  const original = state.policies.filter((p) => !BOUNDARIES.some(([table, name]) => p.table === table && p.name === name));
  if (original.length !== ORIGINAL_NAMES.length || !ORIGINAL_NAMES.every(([table, name, cmd]) => {
    const p = original.find((item) => item.table === table && item.name === name);
    return p?.cmd === cmd && p.permissive === "PERMISSIVE"
      && JSON.stringify(p.roles) === '["authenticated"]';
  })) throw new Error("Vault original policy catalogue differs from reviewed predecessor");
  const restricted = state.policies.filter((p) => BOUNDARIES.some(([table, name]) => p.table === table && p.name === name));
  if (state.latest === PREDECESSOR && !state.ledger && restricted.length === 0
    && state.catalogue_md5 === ORIGINAL_CATALOGUE_MD5) return "ready";
  const marker = `FVI vault active tenant boundary; sha256=${SOURCE_SHA256}`;
  if (state.latest === VERSION && state.ledger?.name === NAME && state.ledger.statements?.[0] === marker
    && state.ledger.statements?.[1] === INSTALLED_CATALOGUE_MD5
    && state.catalogue_md5 === INSTALLED_CATALOGUE_MD5 && restricted.length === BOUNDARIES.length
    && BOUNDARIES.every(([table, name]) => restricted.some((p) => p.table === table && p.name === name
      && p.cmd === "ALL" && p.permissive === "RESTRICTIVE"
      && JSON.stringify(p.roles) === '["authenticated"]' && p.qual && p.check))) return "installed";
  throw new Error("Vault exact predecessor/ledger/restrictive-policy readback failed");
}

export function buildApplySql(source, before) {
  if ((source.match(/^BEGIN;\r?$/gmu) ?? []).length !== 1 || (source.match(/^COMMIT;\r?$/gmu) ?? []).length !== 1) {
    throw new Error("Expected a single vault migration transaction envelope");
  }
  const body = source.replace(/^BEGIN;\r?\n/mu, "").replace(/^COMMIT;\s*$/mu, "");
  const marker = `FVI vault active tenant boundary; sha256=${SOURCE_SHA256}`;
  return `BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE ${TABLES.map((table) => `public.${table}`).join(",")} IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$ BEGIN
  IF (SELECT max(version::text) FROM supabase_migrations.schema_migrations) IS DISTINCT FROM '${PREDECESSOR}'
    OR ${catalogueMd5Sql} IS DISTINCT FROM '${ORIGINAL_CATALOGUE_MD5}' THEN
    RAISE EXCEPTION 'Vault state changed since preflight';
  END IF;
END $preflight$;
${body}
DO $postflight$ BEGIN
  IF ${catalogueMd5Sql} IS DISTINCT FROM '${INSTALLED_CATALOGUE_MD5}' THEN
    RAISE EXCEPTION 'Vault restrictive policy catalogue differs from reviewed migration';
  END IF;
END $postflight$;
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES ('${VERSION}','${NAME}',ARRAY[${literal(marker)},'${INSTALLED_CATALOGUE_MD5}']);
COMMIT;`;
}

export async function runInstaller({ env = process.env, readText = readFile, request = fetch, emit = console.log } = {}) {
  const source = await readText(`supabase/migrations/${VERSION}_${NAME}.sql`, "utf8");
  if (createHash("sha256").update(source).digest("hex") !== SOURCE_SHA256) {
    throw new Error("Vault migration checksum differs from locally verified source");
  }
  const vaultPath = env.FVI_VAULT_PATH ?? "";
  if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
    throw new Error("Set FVI_VAULT_PATH to the canonical secured vault");
  }
  const vault = await readText(vaultPath, "utf8");
  const begin = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
  const end = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
  if (begin < 0 || end <= begin) throw new Error("Canonical credential section unavailable");
  const row = vault.slice(begin, end).split(/\r?\n/u).find((line) => /^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/u.test(line));
  const token = row?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
  if (!/^sbp_[A-Za-z0-9_-]{20,}$/u.test(token ?? "")) throw new Error("Canonical Management access unavailable");
  async function management(endpoint, options = {}) {
    const response = await request(`https://api.supabase.com/v1/projects/${PROJECT_REF}/${endpoint}`, {
      ...options, headers: { authorization: `Bearer ${token}`, ...options.headers }, signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Vault Management HTTP ${response.status}`);
    return response.json();
  }
  const query = (statement, readOnly = true) => management("database/query", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ query: statement, read_only: readOnly }) });
  const [rows, backups] = await Promise.all([query(STATE_SQL), management("database/backups")]);
  const before = rows?.[0]?.state;
  const latestBackup = backups.backups?.filter((item) => item.status === "COMPLETED")
    .sort((a, b) => String(b.inserted_at).localeCompare(String(a.inserted_at)))[0];
  const age = Date.now() - Date.parse(String(latestBackup?.inserted_at));
  const fresh = Number.isFinite(age) && age >= 0 && age <= 24 * 60 * 60 * 1000;
  const state = assessState(before, fresh);
  const result = { ok: true, target: "prod", project_ref: PROJECT_REF, version: VERSION,
    source_sha256: SOURCE_SHA256, latest_completed_backup_at: latestBackup.inserted_at,
    pitr_enabled: backups.pitr_enabled, original_policy_count: 8 };
  if (state === "installed") { emit(JSON.stringify({ ...result, reused: true, restrictive_policy_count: 4 })); return; }
  if (env.FVI_APPLY_VAULT_ACTIVE_TENANT_BOUNDARY !== "YES") {
    emit(JSON.stringify({ ...result, dry_run: true, ledger_latest: before.latest, restrictive_policy_count: 0 })); return;
  }
  await query(buildApplySql(source, before), false);
  const after = (await query(STATE_SQL))?.[0]?.state;
  if (assessState(after, fresh) !== "installed") throw new Error("Vault write returned without exact verified readback");
  emit(JSON.stringify({ ...result, applied: true, restrictive_policy_count: 4 }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runInstaller().catch((error) => {
    const safe = error instanceof Error && /^(Vault|Expected a single|Set FVI_VAULT_PATH|Canonical)/u.test(error.message)
      ? error.message : "Vault installer failed; no sensitive diagnostic output emitted";
    console.error(safe); process.exitCode = 1;
  });
}
