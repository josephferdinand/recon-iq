import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCanonicalVault, TARGETS } from "./preflight-fvi-resource-identity-release.mjs";

const target = process.argv[2];
const projectRef = TARGETS[target];
if (!projectRef) throw new Error("Specify exact target prod or dev");
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
  if (!response.ok) throw new Error(`Environment importer preflight failed: HTTP ${response.status}`);
  return response.json();
}
const sql = `select jsonb_build_object(
  'ledger_latest',(select max(version::text) from supabase_migrations.schema_migrations),
  'legacy_receiver',to_regprocedure('public.receive_environment_change_for_api(jsonb,text)') is not null,
  'bound_receiver',to_regprocedure('public.receive_environment_change_for_api(jsonb,text,uuid)') is not null,
  'legacy_service_role_execute',case when to_regprocedure('public.receive_environment_change_for_api(jsonb,text)') is null
    then false else has_function_privilege('service_role',to_regprocedure('public.receive_environment_change_for_api(jsonb,text)'),'EXECUTE') end,
  'bound_service_role_execute',case when to_regprocedure('public.receive_environment_change_for_api(jsonb,text,uuid)') is null
    then false else has_function_privilege('service_role',to_regprocedure('public.receive_environment_change_for_api(jsonb,text,uuid)'),'EXECUTE') end,
  'requests_by_stage',coalesce((select jsonb_agg(jsonb_build_object('stage',approval_stage,'status',status,
      'transport',transport_status,'count',n) order by approval_stage,status,transport_status)
    from (select approval_stage,status,transport_status,count(*) n
      from public.environment_change_requests group by approval_stage,status,transport_status) s),'[]'::jsonb),
  'pending_target_review',(select count(*) from public.environment_change_requests
    where approval_stage='target_review' and status='pending_approval'),
  'pending_source_transport',(select count(*) from public.environment_change_requests
    where approval_stage='source_review' and status='approved'
      and coalesce(transport_status,'') in ('pending','in_progress')),
  'pending_source_rows',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'uid',change_request_uid,'target_ref',target_project_ref,
      'target_tenant_id',target_tenant_id,'decided_by',decided_by,
      'decided_at',decided_at,'transport_status',transport_status) order by decided_at)
    from public.environment_change_requests
    where approval_stage='source_review' and status='approved'
      and coalesce(transport_status,'') in ('pending','in_progress')),'[]'::jsonb),
  'intake_actor', (select jsonb_build_object('id',u.id,'platform_admin',
    exists(select 1 from public.platform_roles p where p.user_id=u.id and p.role='platform_admin'),
    'banned_for_99_years',u.banned_until>now()+interval '99 years',
    'email_unconfirmed',u.email_confirmed_at is null,
    'no_sessions',not exists(select 1 from auth.sessions s where s.user_id=u.id))
    from auth.users u where lower(u.email)=lower('fvi-environment-intake-${target}@fvi.invalid') limit 1)
) as state`;
const [rows, backup] = await Promise.all([
  management("database/query", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true }),
  }),
  management("database/backups"),
]);
const state = rows?.[0]?.state;
if (!state) throw new Error("Environment importer state unavailable");
const latestBackup = backup.backups?.filter((item) => item.status === "COMPLETED")
  .sort((a, b) => String(b.inserted_at).localeCompare(String(a.inserted_at)))[0];
console.log(JSON.stringify({ target, project_ref: projectRef, ...state,
  latest_completed_backup_at: latestBackup?.inserted_at ?? null,
  pitr_enabled: backup.pitr_enabled }, null, 2));
