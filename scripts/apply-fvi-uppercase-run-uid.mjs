import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const target = process.env.FVI_RUN_UID_TARGET;
const projectRef = { prod: "YOUR_PROJECT_REF", dev: "YOUR_PROJECT_REF" }[target];
if (!projectRef) throw new Error("FVI_RUN_UID_TARGET must be prod or dev");
if (target === "dev" && process.env.FVI_ALLOW_DEV_REPLICATION !== "YES") {
  throw new Error("DEV Run ID migration requires the approved full-replication gate");
}
const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Set FVI_VAULT_PATH to the canonical secured vault");
}
const vault = await readFile(vaultPath, "utf8");
const start = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
const end = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
if (start < 0 || end <= start) throw new Error("Canonical FVI credentials section unavailable");
const tokenRow = vault.slice(start, end).split(/\r?\n/u)
  .find((line) => line.startsWith("| `SUPABASE_ACCESS_TOKEN` |"));
const token = tokenRow?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
if (!token) throw new Error("FVI Management API credential unavailable");

const version = "20260923090000";
const name = "uppercase_recon_run_uid";
const source = await readFile(path.resolve(`supabase/migrations/${version}_${name}.sql`), "utf8");
const sha256 = createHash("sha256").update(source).digest("hex");
async function query(sql, readOnly) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`FVI migration query failed with HTTP ${response.status}`);
  return response.json();
}
const before = (await query(`select
  (select version from supabase_migrations.schema_migrations order by version desc limit 1) as latest,
  exists(select 1 from supabase_migrations.schema_migrations where version='${version}') as ledgered,
  pg_get_functiondef(to_regprocedure('public.tg_recon_run_uid()')) as definition,
  (select count(*)::integer from (
    select upper(run_uid) from public.recon_runs where run_uid is not null
    group by upper(run_uid) having count(*) > 1
  ) duplicates) as case_duplicate_groups`, true))[0];
if (!before?.definition || before.case_duplicate_groups !== 0) {
  throw new Error("Run ID preflight failed: trigger unavailable or case-insensitive duplicates exist");
}
const hasSixteen = /substr\([^;]+,\s*1,\s*16\)/u.test(before.definition);
if (before.ledgered) {
  if (!hasSixteen) throw new Error("Run ID migration is ledgered but the trigger is not updated");
  console.log(JSON.stringify({ ok: true, target, version, sha256, reused: true }));
} else {
  if (before.latest !== "20260921120000" || hasSixteen) {
    throw new Error("Run ID migration is not the next expected PROD ledger step");
  }
  if (process.env.FVI_APPLY_UPPERCASE_RUN_UID !== "YES") {
    console.log(JSON.stringify({ ok: true, target, version, sha256, dry_run: true,
      latest: before.latest, case_duplicate_groups: before.case_duplicate_groups }));
  } else {
    const marker = `FVI controlled Management API; sha256=${sha256}`;
    await query(`begin;\n${source}\ninsert into supabase_migrations.schema_migrations(version,name,statements)
      values ('${version}','${name}',array['${marker}']);\nnotify pgrst, 'reload schema';\ncommit;`, false);
    const after = (await query(`select
      exists(select 1 from supabase_migrations.schema_migrations where version='${version}') as ledgered,
      pg_get_functiondef(to_regprocedure('public.tg_recon_run_uid()')) as definition`, true))[0];
    if (!after?.ledgered || !/substr\([^;]+,\s*1,\s*16\)/u.test(after.definition ?? "")) {
      throw new Error("Run ID migration postcondition failed");
    }
    console.log(JSON.stringify({ ok: true, target, version, sha256, applied: true }));
  }
}
