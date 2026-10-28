import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const target = process.env.FVI_DASHBOARD_TARGET ?? "";
const project = { prod: "YOUR_PROJECT_REF", dev: "YOUR_PROJECT_REF" }[target];
if (!project || process.env.FVI_ALLOW_EXCEPTION_DASHBOARD_MIGRATION !== "YES") {
  throw new Error("Set FVI_DASHBOARD_TARGET and FVI_ALLOW_EXCEPTION_DASHBOARD_MIGRATION=YES");
}
if (target === "dev" && process.env.FVI_ALLOW_DEV_REPLICATION !== "YES") {
  throw new Error("DEV remains deferred until the approved complete-PROD replication batch");
}
const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Set the canonical FVI secured vault");
}
const vault = await readFile(vaultPath, "utf8");
const start = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
const end = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
if (start < 0 || end <= start) throw new Error("Canonical credential section unavailable");
const row = vault
  .slice(start, end)
  .split(/\r?\n/u)
  .find((line) => line.startsWith("| `SUPABASE_ACCESS_TOKEN` |"));
const token = row?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
if (!token) throw new Error("FVI Management credential unavailable");
async function query(sql, readOnly) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
  });
  if (!response.ok)
    throw new Error(`Exception dashboard migration query failed: HTTP ${response.status}`);
  return response.json();
}
const version = "20260915003000";
const name = "create_exception_dashboard";
const source = await readFile(`supabase/migrations/${version}_${name}.sql`, "utf8");
const sha256 = createHash("sha256").update(source).digest("hex");
const existing = (
  await query(
    `select statements from supabase_migrations.schema_migrations where version='${version}'`,
    true,
  )
)[0];
if (existing) {
  if (!existing.statements?.some((statement) => statement.includes(`sha256=${sha256}`))) {
    throw new Error("Existing exception dashboard migration does not match recorded source hash");
  }
} else {
  await query(
    `begin;\n${source}\ninsert into supabase_migrations.schema_migrations(version,name,statements)
    values ('${version}','${name}',array['FVI controlled Management API; sha256=${sha256}']);
    notify pgrst, 'reload schema';\ncommit;`,
    false,
  );
}
const effects = (
  await query(
    `select
  (select count(*)::int from supabase_migrations.schema_migrations) as ledger_count,
  not procedure.prosecdef as security_invoker,
  procedure.proconfig @> array['row_security=on'] as row_security_on,
  has_function_privilege('authenticated',procedure.oid,'EXECUTE') as authenticated_execute,
  not has_function_privilege('anon',procedure.oid,'EXECUTE') as anonymous_denied,
  (select count(*)::int from pg_indexes where schemaname='public' and indexname in
    ('recon_exceptions_dashboard_window_idx','recon_exceptions_dashboard_open_idx')) as dashboard_indexes
from pg_proc procedure where procedure.oid=to_regprocedure('public.get_exception_dashboard(uuid,integer)')`,
    true,
  )
)[0];
if (
  !effects ||
  effects.ledger_count !== 338 ||
  !effects.security_invoker ||
  !effects.row_security_on ||
  !effects.authenticated_execute ||
  !effects.anonymous_denied ||
  effects.dashboard_indexes !== 2
) {
  throw new Error("Exception dashboard migration readback failed");
}
console.log(
  JSON.stringify({ ok: true, target, version, sha256, reused: Boolean(existing), ...effects }),
);
