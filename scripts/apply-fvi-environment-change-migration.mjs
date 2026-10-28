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
const patFile = process.env.FVI_SUPABASE_PAT_FILE ?? "";
if (!path.isAbsolute(patFile)) {
  throw new Error("FVI_SUPABASE_PAT_FILE must be an absolute protected file");
}
const accessToken = (await readFile(patFile, "utf8")).trim();
if (!/^sbp_[A-Za-z0-9_-]{20,}$/u.test(accessToken)) {
  throw new Error("Protected Management API token is unavailable");
}

const version = "20260908203000";
const name = "govern_environment_changes";
const migrationPath = path.resolve(
  "supabase/migrations/20260908203000_govern_environment_changes.sql",
);
const migration = await readFile(migrationPath, "utf8");
const sha256 = createHash("sha256").update(migration).digest("hex");
const effectSql = `select
  to_regclass('public.environment_change_requests') is not null as requests_table,
  to_regclass('public.environment_change_events') is not null as events_table,
  to_regprocedure('public.request_environment_change(jsonb)') is not null as request_ui,
  to_regprocedure('public.request_environment_change_for_api(jsonb,uuid)') is not null as request_api,
  to_regprocedure('public.decide_environment_change(uuid,boolean,text)') is not null as decision_ui,
  to_regprocedure('public.decide_environment_change_for_api(uuid,boolean,text,uuid)') is not null as decision_api,
  to_regprocedure('public.record_environment_change_preflight_for_api(uuid,jsonb,uuid)') is not null as preflight_api,
  to_regprocedure('public.start_environment_change_execution_for_api(uuid,text,uuid)') is not null as start_api,
  to_regprocedure('public.complete_environment_change_execution_for_api(uuid,text,jsonb,jsonb,text,uuid)') is not null as complete_api,
  exists(select 1 from pg_trigger where tgname='guard_environment_change_requests' and not tgisinternal) as request_guard,
  exists(select 1 from pg_trigger where tgname='guard_environment_change_events' and not tgisinternal) as event_guard,
  coalesce(not has_table_privilege('authenticated',to_regclass('public.environment_change_requests'),'INSERT'),false) as authenticated_insert_denied,
  coalesce(not has_table_privilege('service_role',to_regclass('public.environment_change_requests'),'INSERT'),false) as service_insert_denied,
  coalesce(has_function_privilege('service_role',to_regprocedure('public.start_environment_change_execution_for_api(uuid,text,uuid)'),'EXECUTE'),false) as service_executes,
  exists(select 1 from supabase_migrations.schema_migrations where version='${version}') as ledgered,
  (select count(*)::integer from supabase_migrations.schema_migrations) as ledger_count`;
const effectKeys = [
  "requests_table",
  "events_table",
  "request_ui",
  "request_api",
  "decision_ui",
  "decision_api",
  "preflight_api",
  "start_api",
  "complete_api",
  "request_guard",
  "event_guard",
  "authenticated_insert_denied",
  "service_insert_denied",
  "service_executes",
];

async function query(sql, readOnly) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
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
    throw new Error("Environment change migration is ledgered but effects are incomplete");
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
  process.exit(0);
}
if (effects.some(Boolean)) {
  throw new Error(
    "Environment change effects exist without ledger evidence; refusing metadata reconstruction",
  );
}
const marker = `Applied by FVI controlled Management API; sha256=${sha256}`.replaceAll("'", "''");
await query(
  `begin;\n${migration}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values ('${version}','${name}',array['${marker}']);\ncommit;`,
  false,
);
const after = (await query(effectSql, true))[0];
if (!after.ledgered || effectKeys.some((key) => !after[key])) {
  throw new Error("Environment change migration readback failed");
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
