import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const targetName = process.env.FVI_DATA_PREP_TARGET ?? "";
const targets = { prod: "YOUR_PROJECT_REF", dev: "YOUR_PROJECT_REF" };
const projectRef = targets[targetName];
if (!projectRef) throw new Error("FVI_DATA_PREP_TARGET must be prod or dev");
if (process.env.FVI_ALLOW_DATA_PREP_MIGRATION !== "YES")
  throw new Error("Set FVI_ALLOW_DATA_PREP_MIGRATION=YES");
if (targetName === "dev" && process.env.FVI_ALLOW_DEV_REPLICATION !== "YES") {
  throw new Error("DEV replication requires FVI_ALLOW_DEV_REPLICATION=YES after PROD acceptance");
}
const patFile = process.env.FVI_SUPABASE_PAT_FILE ?? "";
if (!path.isAbsolute(patFile))
  throw new Error("FVI_SUPABASE_PAT_FILE must be an absolute protected file");
const accessToken = (await readFile(patFile, "utf8")).trim();
if (!/^sbp_[A-Za-z0-9_-]{20,}$/u.test(accessToken))
  throw new Error("Protected Management API token is unavailable");

const migrations = [
  {
    version: "20260908173000",
    name: "govern_data_prep_lifecycle",
    path: "supabase/migrations/20260908173000_govern_data_prep_lifecycle.sql",
    effectKeys: [
      "approve_ui",
      "approve_api",
      "upsert_api",
      "archive_api",
      "staging_api",
      "request_api",
      "decision_api",
      "lifecycle_guard",
      "api_private",
      "service_executes",
    ],
    effects: `
      to_regprocedure('public.approve_data_prep_pipeline(uuid,uuid)') is not null as approve_ui,
      to_regprocedure('public.approve_data_prep_pipeline_for_api(uuid,uuid,uuid)') is not null as approve_api,
      to_regprocedure('public.upsert_data_prep_pipeline_for_api(uuid,uuid,jsonb,uuid)') is not null as upsert_api,
      to_regprocedure('public.archive_data_prep_pipeline_for_api(uuid,uuid,text,uuid)') is not null as archive_api,
      to_regprocedure('public.clone_data_prep_staging_for_api(uuid,uuid,uuid)') is not null as staging_api,
      to_regprocedure('public.request_data_prep_promotion_for_api(uuid,uuid,text,uuid)') is not null as request_api,
      to_regprocedure('public.decide_data_prep_promotion_for_api(uuid,uuid,boolean,text,uuid)') is not null as decision_api,
      exists(select 1 from pg_trigger where tgname='guard_data_prep_lifecycle' and not tgisinternal) as lifecycle_guard,
      coalesce(not has_function_privilege('authenticated',to_regprocedure('public.approve_data_prep_pipeline_for_api(uuid,uuid,uuid)'),'EXECUTE'),false) as api_private,
      coalesce(has_function_privilege('service_role',to_regprocedure('public.approve_data_prep_pipeline_for_api(uuid,uuid,uuid)'),'EXECUTE'),false) as service_executes`,
  },
  {
    version: "20260908184500",
    name: "add_data_prep_ui_upsert_wrapper",
    path: "supabase/migrations/20260908184500_add_data_prep_ui_upsert_wrapper.sql",
    effectKeys: ["upsert_ui", "authenticated_executes", "anon_denied"],
    effects: `
      to_regprocedure('public.upsert_data_prep_pipeline(uuid,uuid,jsonb)') is not null as upsert_ui,
      coalesce(has_function_privilege('authenticated',to_regprocedure('public.upsert_data_prep_pipeline(uuid,uuid,jsonb)'),'EXECUTE'),false) as authenticated_executes,
      coalesce(not has_function_privilege('anon',to_regprocedure('public.upsert_data_prep_pipeline(uuid,uuid,jsonb)'),'EXECUTE'),false) as anon_denied`,
  },
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
      /* preserve stable non-sensitive fallback */
    }
    throw new Error(`Supabase Management API query failed with HTTP ${response.status}: ${detail}`);
  }
  return JSON.parse(raw);
}

for (const item of migrations) {
  const migration = await readFile(path.resolve(item.path), "utf8");
  const sha256 = createHash("sha256").update(migration).digest("hex");
  const effectSql = `select ${item.effects},
    exists(select 1 from supabase_migrations.schema_migrations where version='${item.version}') as ledgered,
    (select count(*)::integer from supabase_migrations.schema_migrations) as ledger_count`;
  const before = (await query(effectSql, true))[0];
  const effects = item.effectKeys.map((key) => Boolean(before[key]));
  if (before.ledgered) {
    if (effects.some((value) => !value))
      throw new Error(`Data Prep migration ${item.version} is ledgered but effects are incomplete`);
    console.log(
      JSON.stringify({
        ok: true,
        target: targetName,
        version: item.version,
        sha256,
        reused: true,
        ledger_count: before.ledger_count,
      }),
    );
    continue;
  }
  if (effects.some(Boolean))
    throw new Error(
      `Data Prep migration ${item.version} effects exist without ledger evidence; refusing metadata reconstruction`,
    );
  const marker = `Applied by FVI controlled Management API; sha256=${sha256}`.replaceAll("'", "''");
  await query(
    `begin;\n${migration}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values ('${item.version}','${item.name}',array['${marker}']);\ncommit;`,
    false,
  );
  const after = (await query(effectSql, true))[0];
  if (!after.ledgered || item.effectKeys.some((key) => !after[key]))
    throw new Error(`Data Prep lifecycle migration ${item.version} readback failed`);
  console.log(
    JSON.stringify({
      ok: true,
      target: targetName,
      version: item.version,
      sha256,
      reused: false,
      ledger_count: after.ledger_count,
    }),
  );
}
