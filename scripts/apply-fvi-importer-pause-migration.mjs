import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCanonicalVault, TARGETS } from "./preflight-fvi-resource-identity-release.mjs";

const target = process.argv[2];
if (target !== "prod") {
  throw new Error("This guarded pause installer is PROD-only; DEV requires a separately reviewed ordered preflight");
}
const projectRef = TARGETS.prod;
const version = "20260923132900";
const name = "environment_change_cutover_pause";
const source = await readFile(`supabase/migrations/${version}_${name}.sql`, "utf8");
const sourceHash = createHash("sha256").update(source).digest("hex");
const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Set FVI_VAULT_PATH to the canonical secured vault");
}
const token = parseCanonicalVault(await readFile(vaultPath, "utf8"));

async function management(endpoint, options = {}) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/${endpoint}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...options.headers },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const reason = typeof failure?.message === "string" ? failure.message
      : typeof failure?.error === "string" ? failure.error : "unavailable";
    throw new Error(`Importer pause Management HTTP ${response.status}: ${reason.slice(0, 300)}`);
  }
  return response.json();
}

async function query(statement, readOnly = true) {
  return management("database/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: statement, read_only: readOnly }),
  });
}

const beforeSql = `select jsonb_build_object(
  'latest',(select max(version::text) from supabase_migrations.schema_migrations),
  'ledgered',exists(select 1 from supabase_migrations.schema_migrations where version::text='${version}'),
  'legacy_receiver',to_regprocedure('public.receive_environment_change_for_api(jsonb,text)') is not null,
  'legacy_service_execute',case when to_regprocedure('public.receive_environment_change_for_api(jsonb,text)') is null
    then false else has_function_privilege('service_role',to_regprocedure('public.receive_environment_change_for_api(jsonb,text)'),'EXECUTE') end,
  'bound_receiver',to_regprocedure('public.receive_environment_change_for_api(jsonb,text,uuid)') is not null,
  'gate_exists',to_regclass('public.environment_change_cutover_gate') is not null,
  'pending_source_transport',(select count(*) from public.environment_change_requests
    where approval_stage='source_review' and status='approved'
      and coalesce(transport_status,'') in ('pending','in_progress')),
  'pending_target_review',(select count(*) from public.environment_change_requests
    where approval_stage='target_review' and status='pending_approval'),
  'pending_source_rows',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'uid',change_request_uid,'target_ref',target_project_ref,
      'target_tenant_id',target_tenant_id,'transport_status',transport_status,
      'decided_at',decided_at) order by decided_at)
    from public.environment_change_requests
    where approval_stage='source_review' and status='approved'
      and coalesce(transport_status,'') in ('pending','in_progress')),'[]'::jsonb)
) as state`;

const [beforeRows, backup] = await Promise.all([
  query(beforeSql),
  management("database/backups"),
]);
const before = beforeRows?.[0]?.state;
const latestBackup = backup.backups?.filter((item) => item.status === "COMPLETED")
  .sort((a, b) => String(b.inserted_at).localeCompare(String(a.inserted_at)))[0];
if (!before || !latestBackup) throw new Error("PROD importer state or completed backup unavailable");

const backupAt = Date.parse(String(latestBackup.inserted_at));
const backupAgeMs = Date.now() - backupAt;
const backupFresh = Number.isFinite(backupAt) && backupAgeMs >= 0 && backupAgeMs <= 24 * 60 * 60 * 1000;
const preflight = before.latest === "20260923090100" && !before.ledgered
  && before.legacy_receiver && before.legacy_service_execute
  && !before.bound_receiver && !before.gate_exists && backupFresh;

const gateSql = `select jsonb_build_object(
  'latest',(select max(version::text) from supabase_migrations.schema_migrations),
  'ledgered',exists(select 1 from supabase_migrations.schema_migrations where version::text='${version}'),
  'gate_paused',(select paused from public.environment_change_cutover_gate where singleton=true),
  'pause_trigger',exists(select 1 from pg_trigger t
    where t.tgrelid='public.environment_change_requests'::regclass
      and t.tgname='environment_change_cutover_pause' and not t.tgisinternal),
  'export_pause_trigger',exists(select 1 from pg_trigger t
    where t.tgrelid='public.environment_change_events'::regclass
      and t.tgname='environment_change_export_cutover_pause' and not t.tgisinternal),
  'pending_source_rows',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'uid',change_request_uid,'target_ref',target_project_ref,
      'target_tenant_id',target_tenant_id,'transport_status',transport_status,
      'decided_at',decided_at) order by decided_at)
    from public.environment_change_requests
    where approval_stage='source_review' and status='approved'
      and coalesce(transport_status,'') in ('pending','in_progress')),'[]'::jsonb)
) as state`;

if (before.latest === version && before.ledgered && before.gate_exists) {
  const afterRows = await query(gateSql);
  const after = afterRows?.[0]?.state;
  if (after?.latest === version && after.ledgered && after.gate_paused === true
      && after.pause_trigger === true && after.export_pause_trigger === true) {
    console.log(JSON.stringify({ ok: true, target, project_ref: projectRef, version,
      source_sha256: sourceHash, reused: true, gate_paused: true,
      pending_source_transport: before.pending_source_transport,
      pending_source_rows: before.pending_source_rows,
      pending_target_review: before.pending_target_review,
      latest_completed_backup_at: latestBackup.inserted_at,
      pitr_enabled: backup.pitr_enabled }, null, 2));
    process.exit(0);
  }
  throw new Error("Pause migration is already ledgered but the fail-closed gate/trigger readback is not safe");
}

if (!preflight) {
  throw new Error("Pause migration is not the exact next safe PROD ledger/backup state");
}

if (process.env.FVI_APPLY_IMPORTER_PAUSE_GATE !== "YES") {
  console.log(JSON.stringify({ ok: true, target, project_ref: projectRef, version,
    source_sha256: sourceHash, dry_run: true, ledger_latest: before.latest,
    gate_exists: before.gate_exists,
    pending_source_transport: before.pending_source_transport,
    pending_source_rows: before.pending_source_rows,
    pending_target_review: before.pending_target_review,
    latest_completed_backup_at: latestBackup.inserted_at,
    pitr_enabled: backup.pitr_enabled,
    note: "Daily backup presence is not a restore rehearsal; rollback readiness needs separate owner review." }, null, 2));
  process.exit(0);
}

const requiredFlags = [
  "FVI_IMPORTS_FROZEN",
  "FVI_IMPORTS_DRAINED",
  "FVI_PAIRED_APP_PAUSED",
  "FVI_PAIRED_WORKER_PAUSED",
  "FVI_IMPORTER_RECOVERY_REVIEWED",
];
// These are operator attestations after independent app/Worker version and
// in-flight-request readback; the script does not treat env flags as evidence.
if (requiredFlags.some((flag) => process.env[flag] !== "YES")) {
  throw new Error("Importer pause install requires frozen/drained callers, paused app/Worker readback, and reviewed recovery plan");
}

const marker = `FVI guarded importer pause; sha256=${sourceHash}`;
const applySql = `
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SELECT set_config('fvi.importer_cutover_atomic','on',true);
${source}
SELECT public.set_environment_change_cutover_pause(
  true,
  'Guarded PROD importer cutover: callers frozen and drained'
);
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
  VALUES ('${version}','${name}',ARRAY['${marker}']);
NOTIFY pgrst, 'reload schema';
COMMIT;
`;
await query(applySql, false);

const afterRows = await query(gateSql);
const after = afterRows?.[0]?.state;
if (!after || after.latest !== version || !after.ledgered || after.gate_paused !== true
    || !after.pause_trigger || !after.export_pause_trigger
    || JSON.stringify(after.pending_source_rows) !== JSON.stringify(before.pending_source_rows)) {
  throw new Error("Pause-gate transaction postcondition failed; keep app/Worker paused and inspect forward");
}

console.log(JSON.stringify({ ok: true, target, project_ref: projectRef, version,
  source_sha256: sourceHash, applied: true, gate_paused: true,
  pending_source_transport: before.pending_source_transport,
  pending_source_rows: before.pending_source_rows,
  pending_target_review: before.pending_target_review,
  latest_completed_backup_at: latestBackup.inserted_at,
  pitr_enabled: backup.pitr_enabled }, null, 2));
