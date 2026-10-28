import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const targetName = process.env.FVI_TEMPLATE_TARGET ?? "";
const projectRef = { prod: "YOUR_PROJECT_REF", dev: "YOUR_PROJECT_REF" }[targetName];
if (!projectRef) throw new Error("FVI_TEMPLATE_TARGET must be prod or dev");
if (process.env.FVI_ALLOW_TEMPLATE_MIGRATIONS !== "YES") throw new Error("Set FVI_ALLOW_TEMPLATE_MIGRATIONS=YES");
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
  const line = markdown.slice(start, end).split(/\r?\n/u).find((candidate) => candidate.startsWith(`| \`${key}\` |`));
  const value = line?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
  if (!value) throw new Error(`Missing vault field ${key}`);
  return value;
}
const token = vaultValue(await readFile(vaultPath, "utf8"), "SUPABASE_ACCESS_TOKEN");
const migrations = [
  ["20260914210000", "install_recon_starter_templates_atomically"],
  ["20260914220000", "govern_tenant_template_lifecycle"],
  ["20260914233000", "support_starter_template_date_age_rule"],
  ["20260921120000", "enrich_template_transition_audit_version"],
];
async function query(sql, readOnly) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
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
const applied = [];
for (const [version, name] of migrations) {
  const existing = (await query(`select statements from supabase_migrations.schema_migrations where version='${version}'`, true))[0];
  const exists = Boolean(existing);
  const body = await readFile(path.resolve(`supabase/migrations/${version}_${name}.sql`), "utf8");
  const sha256 = createHash("sha256").update(body).digest("hex");
  if (exists && !existing.statements?.some((statement) => statement.includes(`sha256=${sha256}`))) {
    throw new Error(`Existing migration ${version} does not match its recorded source hash`);
  }
  if (!exists) {
    const marker = `Applied by FVI controlled Management API; sha256=${sha256}`;
    await query(`begin;\n${body}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values ('${version}','${name}',array['${marker}']);\ncommit;`, false);
  }
  applied.push({ version, sha256, reused: exists });
}
const effectSql = `select
  (select count(*)::integer from supabase_migrations.schema_migrations) as ledger_count,
  to_regprocedure('public.install_recon_starter_template_atomic(uuid,uuid,text,jsonb,jsonb)') is not null as starter_install,
  pg_get_functiondef(to_regprocedure('public.install_recon_starter_template_atomic(uuid,uuid,text,jsonb,jsonb)')) like '%''date_age_days''%' as age_rule_supported,
  to_regprocedure('public.save_tenant_template_from_recon_atomic(uuid,uuid,text,text,uuid,text,text)') is not null as template_save,
  to_regprocedure('public.clone_tenant_template_atomic(uuid,uuid,text)') is not null as template_clone,
  to_regprocedure('public.transition_tenant_template_atomic(uuid,uuid,text)') is not null as template_transition,
  to_regprocedure('public.instantiate_tenant_template_atomic(uuid,uuid,text)') is not null as template_instantiate,
  exists(select 1 from pg_trigger where tgname='guard_tenant_template_lifecycle' and not tgisinternal) as lifecycle_guard,
  exists(select 1 from pg_trigger where tgname='guard_tenant_template_version_immutable' and not tgisinternal) as immutable_versions,
  pg_get_functiondef(to_regprocedure('public.mkt_is_tenant_admin(uuid)')) like '%tm.active%' as active_admin,
  (select count(*)::integer from information_schema.columns where table_schema='public' and table_name='recon_definitions' and column_name in ('starter_template_id','starter_template_code','starter_template_snapshot','tenant_template_id')) as recon_columns`;
const effects = (await query(effectSql, true))[0];
const ok = effects.ledger_count >= 338 && effects.starter_install && effects.age_rule_supported && effects.template_save && effects.template_clone
  && effects.template_transition && effects.template_instantiate && effects.lifecycle_guard
  && effects.immutable_versions && effects.active_admin && effects.recon_columns === 4;
if (!ok) throw new Error("Template lifecycle migration readback failed");
console.log(JSON.stringify({ ok: true, target: targetName, applied, ...effects }));
