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

const version = "20260908234500";
const name = "add_two_stage_environment_delivery";
const migration = await readFile(
  path.resolve("supabase/migrations/20260908234500_add_two_stage_environment_delivery.sql"),
  "utf8",
);
const sha256 = createHash("sha256").update(migration).digest("hex");
const effectSql = `select
  to_regclass('public.environment_release_registry') is not null as registry,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='environment_change_requests' and column_name='approval_stage') as approval_stage,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='environment_change_requests' and column_name='access_mapping_preview') as access_mapping,
  to_regprocedure('public.request_source_environment_change(jsonb)') is not null as source_request,
  to_regprocedure('public.export_approved_environment_change_for_transport(uuid)') is not null as source_export,
  to_regprocedure('public.receive_environment_change_for_api(jsonb,text)') is not null as target_receive,
  to_regprocedure('public.approve_incoming_environment_change(uuid,boolean,text,boolean)') is not null as target_approval,
  to_regprocedure('public.record_environment_change_transport(uuid,boolean,text)') is not null as transport_record,
  coalesce(not has_function_privilege('authenticated',to_regprocedure('public.receive_environment_change_for_api(jsonb,text)'),'EXECUTE'),false) as target_receive_user_denied,
  coalesce(has_function_privilege('service_role',to_regprocedure('public.receive_environment_change_for_api(jsonb,text)'),'EXECUTE'),false) as target_receive_service_allowed,
  exists(select 1 from supabase_migrations.schema_migrations where version='${version}') as ledgered,
  (select count(*)::integer from supabase_migrations.schema_migrations) as ledger_count`;
const effectKeys = [
  "registry",
  "approval_stage",
  "access_mapping",
  "source_request",
  "source_export",
  "target_receive",
  "target_approval",
  "transport_record",
  "target_receive_user_denied",
  "target_receive_service_allowed",
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
  const uat = (
    await query(
      "select exists(select 1 from public.environment_release_registry where environment='uat' and not enabled and project_ref is null) as fail_closed",
      true,
    )
  )[0];
  if (!uat.fail_closed || effects.some((value) => !value)) {
    throw new Error("Two-stage environment delivery is ledgered but effects are incomplete");
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
  throw new Error("Two-stage environment effects exist without ledger evidence");
}
const marker = `Applied by FVI controlled Management API; sha256=${sha256}`.replaceAll("'", "''");
await query(
  `begin;\n${migration}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values ('${version}','${name}',array['${marker}']);\ncommit;`,
  false,
);
const after = (await query(effectSql, true))[0];
const uat = (
  await query(
    "select exists(select 1 from public.environment_release_registry where environment='uat' and not enabled and project_ref is null) as fail_closed",
    true,
  )
)[0];
if (!after.ledgered || !uat.fail_closed || effectKeys.some((key) => !after[key])) {
  throw new Error("Two-stage environment delivery readback failed");
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
