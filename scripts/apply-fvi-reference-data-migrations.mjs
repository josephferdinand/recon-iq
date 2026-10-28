import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const targetName = process.env.FVI_REFERENCE_DATA_TARGET ?? "";
const targets = {
  prod: { ref: "YOUR_PROJECT_REF" },
  dev: { ref: "YOUR_PROJECT_REF" },
};
const target = targets[targetName];
if (!target) throw new Error("FVI_REFERENCE_DATA_TARGET must be prod or dev");
if (process.env.FVI_ALLOW_REFERENCE_DATA_MIGRATION !== "YES") {
  throw new Error("Set FVI_ALLOW_REFERENCE_DATA_MIGRATION=YES");
}
if (targetName === "dev" && process.env.FVI_ALLOW_DEV_REPLICATION !== "YES") {
  throw new Error("DEV replication requires FVI_ALLOW_DEV_REPLICATION=YES after PROD acceptance");
}

const patFile = process.env.FVI_SUPABASE_PAT_FILE ?? "";
if (!path.isAbsolute(patFile)) throw new Error("FVI_SUPABASE_PAT_FILE must be absolute");
const accessToken = (await readFile(patFile, "utf8")).trim();
if (!/^sbp_[A-Za-z0-9_-]{20,}$/u.test(accessToken)) {
  throw new Error("Protected Management API token is unavailable");
}

const migrations = [
  {
    version: "20260906110000",
    name: "harden_reference_data_import",
    path: "supabase/migrations/20260906110000_harden_reference_data_import.sql",
    effects: `
      (select count(*) = 1 from information_schema.columns
        where table_schema='public' and table_name='reference_data_rows' and column_name='key_hash')
        and to_regprocedure('public.bulk_import_reference_data(uuid,uuid,jsonb,boolean)') is not null
        and exists(select 1 from pg_trigger where tgname='reference_data_rows_integrity' and not tgisinternal)
        and to_regclass('public.reference_data_rows_table_key_uq') is not null
    `,
  },
  {
    version: "20260906113000",
    name: "create_reference_data_versions",
    path: "supabase/migrations/20260906113000_create_reference_data_versions.sql",
    effects: `
      to_regclass('public.reference_data_versions') is not null
        and to_regclass('public.reference_data_version_rows') is not null
        and exists(select 1 from information_schema.columns
          where table_schema='public' and table_name='reference_data_tables' and column_name='published_version_id')
        and exists(select 1 from information_schema.columns
          where table_schema='public' and table_name='reference_data_rows' and column_name='version_id')
        and exists(select 1 from pg_trigger where tgname='reference_data_version_rows_immutable' and not tgisinternal)
        and not has_table_privilege('authenticated','public.reference_data_versions','INSERT')
        and not has_table_privilege('authenticated','public.reference_data_version_rows','INSERT')
    `,
  },
  {
    version: "20260906114500",
    name: "reference_data_version_lifecycle",
    path: "supabase/migrations/20260906114500_reference_data_version_lifecycle.sql",
    effects: `
      to_regprocedure('public.stage_reference_data_version(uuid,uuid,jsonb,date,date,text)') is not null
        and to_regprocedure('public.submit_reference_data_version(uuid,uuid)') is not null
        and to_regprocedure('public.decide_reference_data_version(uuid,uuid,boolean,text)') is not null
        and to_regprocedure('public.resolve_reference_data_version(uuid,uuid,date)') is not null
        and to_regprocedure('public.request_reference_data_rollback(uuid,uuid,uuid,date,text)') is not null
        and to_regprocedure('public.stage_reference_data_version_for_api(uuid,uuid,jsonb,date,date,text,uuid)') is not null
        and to_regprocedure('public.resolve_reference_data_version_for_execution(uuid,uuid,date)') is not null
        and exists(select 1 from pg_trigger where tgname='reference_data_table_version_guard' and not tgisinternal)
        and not has_function_privilege('authenticated','public.bulk_import_reference_data(uuid,uuid,jsonb,boolean)','EXECUTE')
        and not has_table_privilege('authenticated','public.reference_data_rows','INSERT')
        and not has_function_privilege('authenticated','public.stage_reference_data_version_for_api(uuid,uuid,jsonb,date,date,text,uuid)','EXECUTE')
    `,
  },
];

async function query(sql, readOnly) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${target.ref}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
  });
  if (!response.ok) throw new Error(`Supabase Management API query failed with HTTP ${response.status}`);
  return response.json();
}

const results = [];
for (const item of migrations) {
  const migration = await readFile(path.resolve(item.path), "utf8");
  const sha256 = createHash("sha256").update(migration).digest("hex");
  const effectSql = `select (${item.effects}) as effects_ok,
    exists(select 1 from supabase_migrations.schema_migrations where version='${item.version}') as ledgered,
    (select count(*)::integer from supabase_migrations.schema_migrations) as ledger_count`;
  const before = (await query(effectSql, true))[0];
  if (before.ledgered) {
    if (!before.effects_ok) throw new Error(`${item.version} is ledgered but effects are incomplete`);
    results.push({ version: item.version, sha256, reused: true, ledger_count: before.ledger_count });
    continue;
  }
  if (before.effects_ok) {
    throw new Error(`${item.version} effects exist without ledger evidence; refusing automatic repair`);
  }
  const marker = `Applied by FVI controlled Management API; sha256=${sha256}`.replaceAll("'", "''");
  await query(
    `begin;\n${migration}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values ('${item.version}','${item.name}',array['${marker}']);\ncommit;`,
    false,
  );
  const after = (await query(effectSql, true))[0];
  if (!after.ledgered || !after.effects_ok) throw new Error(`${item.version} readback failed`);
  results.push({ version: item.version, sha256, reused: false, ledger_count: after.ledger_count });
}

console.log(JSON.stringify({ ok: true, target: targetName, project_ref: target.ref, migrations: results }));
