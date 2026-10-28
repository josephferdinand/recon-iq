import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const targetName = process.env.FVI_THEME_TARGET ?? "";
const projectRef = { prod: "YOUR_PROJECT_REF", dev: "YOUR_PROJECT_REF" }[targetName];
if (!projectRef) throw new Error("FVI_THEME_TARGET must be prod or dev");
if (process.env.FVI_ALLOW_THEME_MIGRATION !== "YES") {
  throw new Error("Set FVI_ALLOW_THEME_MIGRATION=YES");
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
if (!/^sbp_[A-Za-z0-9_-]{20,}$/u.test(accessToken)) {
  throw new Error("Management API token is unavailable");
}

const version = "20260913170000";
const name = "consolidate_theme_catalog";
const migrationPath = path.resolve(`supabase/migrations/${version}_${name}.sql`);
const migration = await readFile(migrationPath, "utf8");
const sha256 = createHash("sha256").update(migration).digest("hex");
const allowedPalettes = "'porcelain', 'cloudy-mist', 'arctic-frost', 'coffee-warm-sand'";
const allowedChromes = "'navy', 'graphite', 'sapphire', 'forest'";

const effectSql = `select
  exists(select 1 from supabase_migrations.schema_migrations where version='${version}') as ledgered,
  (select count(*)::integer from supabase_migrations.schema_migrations) as ledger_count,
  (select count(*)::integer from public.tenant_theme_settings
    where palette_id not in (${allowedPalettes})) as invalid_palettes,
  (select count(*)::integer from public.tenant_theme_settings
    where side_chrome_id not in (${allowedChromes})
       or top_chrome_id not in (${allowedChromes})) as invalid_chromes,
  (select column_default = '''porcelain''::text'
    from information_schema.columns
    where table_schema='public' and table_name='tenant_theme_settings' and column_name='palette_id') as palette_default,
  (select column_default = '''navy''::text'
    from information_schema.columns
    where table_schema='public' and table_name='tenant_theme_settings' and column_name='side_chrome_id') as side_default,
  (select column_default = '''navy''::text'
    from information_schema.columns
    where table_schema='public' and table_name='tenant_theme_settings' and column_name='top_chrome_id') as top_default,
  exists(select 1 from pg_constraint where conname='tenant_theme_settings_palette_id_check') as palette_constraint,
  exists(select 1 from pg_constraint where conname='tenant_theme_settings_side_chrome_id_check') as side_constraint,
  exists(select 1 from pg_constraint where conname='tenant_theme_settings_top_chrome_id_check') as top_constraint,
  (select count(*)::integer from public.audit_log where action='tenant.theme.catalog_migrated') as migration_audits`;

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
  return row.invalid_palettes === 0
    && row.invalid_chromes === 0
    && row.palette_default === true
    && row.side_default === true
    && row.top_default === true
    && row.palette_constraint === true
    && row.side_constraint === true
    && row.top_constraint === true;
}

const before = (await query(effectSql, true))[0];
if (before.ledgered) {
  if (!effectsComplete(before)) throw new Error("Theme migration is ledgered but effects are incomplete");
  console.log(JSON.stringify({
    ok: true,
    target: targetName,
    version,
    sha256,
    reused: true,
    ledger_count: before.ledger_count,
    migration_audits: before.migration_audits,
  }));
} else {
  const marker = `Applied by FVI controlled Management API; sha256=${sha256}`;
  await query(`begin;\n${migration}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values ('${version}','${name}',array['${marker}']);\ncommit;`, false);
  const after = (await query(effectSql, true))[0];
  if (!after.ledgered || !effectsComplete(after)) throw new Error("Theme migration readback failed");
  console.log(JSON.stringify({
    ok: true,
    target: targetName,
    version,
    sha256,
    reused: false,
    ledger_count: after.ledger_count,
    migration_audits: after.migration_audits,
  }));
}
