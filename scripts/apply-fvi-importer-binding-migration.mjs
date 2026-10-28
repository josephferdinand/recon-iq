import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCanonicalVault } from "./preflight-fvi-resource-identity-release.mjs";

const projectRef = "YOUR_PROJECT_REF";
const version = "20260923133000";
const pauseVersion = "20260923132900";
const name = "bind_target_environment_importer";
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
    throw new Error(`Importer migration Management HTTP ${response.status}: ${reason.slice(0, 300)}`);
  }
  return response.json();
}
async function query(statement, readOnly = true) {
  return management("database/query", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: statement, read_only: readOnly }),
  });
}
const stateSql = `select jsonb_build_object(
  'latest',(select max(version::text) from supabase_migrations.schema_migrations),
  'pause_gate_ledgered',exists(select 1 from supabase_migrations.schema_migrations where version::text='${pauseVersion}'),
  'ledgered',exists(select 1 from supabase_migrations.schema_migrations where version::text='${version}'),
  'cutover_gate_paused',(select paused from public.environment_change_cutover_gate where singleton=true),
  'pause_trigger',exists(select 1 from pg_trigger t
    where t.tgrelid='public.environment_change_requests'::regclass
      and t.tgname='environment_change_cutover_pause' and not t.tgisinternal),
  'export_pause_trigger',exists(select 1 from pg_trigger t
    where t.tgrelid='public.environment_change_events'::regclass
      and t.tgname='environment_change_export_cutover_pause' and not t.tgisinternal),
  'legacy_receiver',to_regprocedure('public.receive_environment_change_for_api(jsonb,text)') is not null,
  'legacy_service_execute',case when to_regprocedure('public.receive_environment_change_for_api(jsonb,text)') is null
    then false else has_function_privilege('service_role',to_regprocedure('public.receive_environment_change_for_api(jsonb,text)'),'EXECUTE') end,
  'bound_receiver',to_regprocedure('public.receive_environment_change_for_api(jsonb,text,uuid)') is not null,
  'bound_service_execute',case when to_regprocedure('public.receive_environment_change_for_api(jsonb,text,uuid)') is null
    then false else has_function_privilege('service_role',to_regprocedure('public.receive_environment_change_for_api(jsonb,text,uuid)'),'EXECUTE') end,
  'source_hash_column',exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='environment_change_requests' and column_name='source_requester_email_hash'),
  'binding_event_allowed',coalesce((select pg_get_constraintdef(c.oid) like '%target_importer_bound%'
    from pg_constraint c where c.conrelid='public.environment_change_events'::regclass
      and c.conname='environment_change_events_event_type_check'),false),
  'unbound_guard_trigger',exists(select 1 from pg_trigger t
    where t.tgrelid='public.environment_change_requests'::regclass
      and t.tgname='guard_unbound_target_environment_change' and not t.tgisinternal),
  'pending_target_review',(select count(*) from public.environment_change_requests
    where approval_stage='target_review' and status='pending_approval'),
  'pending_source_transport',(select count(*) from public.environment_change_requests
    where approval_stage='source_review' and status='approved' and transport_status='pending'),
  'pending_source_rows',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'uid',change_request_uid,'target_ref',target_project_ref,
      'target_tenant_id',target_tenant_id,'transport_status',transport_status,
      'decided_at',decided_at) order by decided_at)
    from public.environment_change_requests
    where approval_stage='source_review' and status='approved'
      and coalesce(transport_status,'') in ('pending','in_progress')),'[]'::jsonb),
  'intake_actor_ready',exists(select 1 from auth.users u
    where lower(u.email)='fvi-environment-intake-prod@fvi.invalid'
      and u.banned_until>now()+interval '99 years'
      and u.email_confirmed_at is null
      and not exists(select 1 from auth.sessions s where s.user_id=u.id)
      and exists(select 1 from public.platform_roles p where p.user_id=u.id and p.role='platform_admin'))
) as state`;
const [beforeRows, backup] = await Promise.all([query(stateSql), management("database/backups")]);
const before = beforeRows?.[0]?.state;
const latestBackup = backup.backups?.filter((item) => item.status === "COMPLETED")
  .sort((a, b) => String(b.inserted_at).localeCompare(String(a.inserted_at)))[0];
if (!before || !latestBackup) throw new Error("PROD importer state or completed backup unavailable");
const backupAt = Date.parse(String(latestBackup.inserted_at));
const backupAgeMs = Date.now() - backupAt;
const backupFresh = Number.isFinite(backupAt) && backupAgeMs >= 0 && backupAgeMs <= 24 * 60 * 60 * 1000;
const preflight = before.latest === pauseVersion && before.pause_gate_ledgered
  && before.cutover_gate_paused === true && before.pause_trigger && before.export_pause_trigger
  && !before.ledgered
  && before.legacy_receiver && before.legacy_service_execute
  && !before.bound_receiver && !before.bound_service_execute
  && !before.source_hash_column && !before.binding_event_allowed && !before.unbound_guard_trigger
  && before.pending_target_review === 0 && before.intake_actor_ready && backupFresh;
const postflight = before.latest === version && before.ledgered
  && before.pause_gate_ledgered && before.cutover_gate_paused === true
  && before.pause_trigger && before.export_pause_trigger
  && before.legacy_receiver && !before.legacy_service_execute
  && before.bound_receiver && before.bound_service_execute
  && before.source_hash_column && before.binding_event_allowed && before.unbound_guard_trigger;
if (postflight) {
  console.log(JSON.stringify({ ok: true, project_ref: projectRef, version, source_sha256: sourceHash,
    reused: true, cutover_gate_paused: true,
    pending_source_transport: before.pending_source_transport,
    pending_source_rows: before.pending_source_rows }));
  await new Promise((resolve) => setTimeout(resolve, 250));
  process.exit(0);
}
if (!preflight) {
  throw new Error("Importer migration is not the exact next safe PROD ledger/effects step");
}
if (process.env.FVI_APPLY_IMPORTER_BINDING !== "YES") {
  console.log(JSON.stringify({ ok: true, project_ref: projectRef, version,
    source_sha256: sourceHash, dry_run: true, ledger_latest: before.latest,
    pause_gate_ledgered: before.pause_gate_ledgered,
    cutover_gate_paused: before.cutover_gate_paused,
    pending_target_review: before.pending_target_review,
    pending_source_transport: before.pending_source_transport,
    pending_source_rows: before.pending_source_rows,
    intake_actor_ready: before.intake_actor_ready,
    latest_completed_backup_at: latestBackup.inserted_at,
    backup_age_hours: +(backupAgeMs / 3_600_000).toFixed(2),
    pitr_enabled: backup.pitr_enabled,
    note: "Migration 133000 is forward-only; PITR/restore readiness must be reviewed before an apply." }, null, 2));
  await new Promise((resolve) => setTimeout(resolve, 250));
  process.exit(0);
}
const requiredFlags = [
  "FVI_IMPORTS_FROZEN",
  "FVI_IMPORTS_DRAINED",
  "FVI_PAIRED_APP_READY",
  "FVI_PAIRED_WORKER_READY",
  "FVI_IMPORTER_RECOVERY_REVIEWED",
];
// These are operator attestations after independent app/Worker version and
// in-flight-request readback; the script does not treat env flags as evidence.
if (requiredFlags.some((flag) => process.env[flag] !== "YES")) {
  throw new Error("Importer cutover requires a verified pause/drain, paired app/Worker readiness, and reviewed forward-recovery plan");
}
const marker = `FVI guarded importer binding; sha256=${sourceHash}`;
await query(`begin;\n${source}\ninsert into supabase_migrations.schema_migrations(version,name,statements)
  values ('${version}','${name}',array['${marker}']);\nnotify pgrst, 'reload schema';\ncommit;`, false);
const after = (await query(stateSql))?.[0]?.state;
if (!after || after.latest !== version || !after.ledgered
  || !after.pause_gate_ledgered || after.cutover_gate_paused !== true
  || !after.pause_trigger || !after.export_pause_trigger
  || !after.legacy_receiver || after.legacy_service_execute
  || !after.bound_receiver || !after.bound_service_execute
  || !after.source_hash_column || !after.binding_event_allowed || !after.unbound_guard_trigger
  || JSON.stringify(after.pending_source_rows) !== JSON.stringify(before.pending_source_rows)) {
  throw new Error("Importer migration postcondition failed; keep intake closed and inspect forward fix");
}
console.log(JSON.stringify({ ok: true, project_ref: projectRef, version,
  source_sha256: sourceHash, applied: true,
  cutover_gate_paused: true,
  pending_source_transport: after.pending_source_transport,
  pending_source_rows: after.pending_source_rows }));
