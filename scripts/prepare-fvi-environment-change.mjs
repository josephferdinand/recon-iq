import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Historical one-stage Management-SQL helper. The governed two-stage release
// retires its direct-create RPC; fail before reading a Management credential.
throw new Error(
  "This legacy environment-change helper is retired. Submit from the source tenant through governed Environment Delivery.",
);

const PROD_REF = "YOUR_PROJECT_REF";
const DEV_REF = "YOUR_PROJECT_REF";
const patFile = process.env.FVI_SUPABASE_PAT_FILE ?? "";
const sourceTenantId = process.env.FVI_ENV_CHANGE_SOURCE_TENANT_ID ?? "";
const targetTenantId = process.env.FVI_ENV_CHANGE_TARGET_TENANT_ID ?? "";
const actorRequestTitle = process.env.FVI_ENV_CHANGE_ACTOR_REQUEST_TITLE ?? "";
const requestTitle = process.env.FVI_ENV_CHANGE_REQUEST_TITLE ?? "";
const idempotencyKey = process.env.FVI_ENV_CHANGE_IDEMPOTENCY_KEY ?? "";
const schemaMigrationFiles = [
  "20260906014500_add_connector_agent_queue.sql",
  "20260906061500_harden_data_watchers.sql",
  "20260906110000_harden_reference_data_import.sql",
  "20260906113000_create_reference_data_versions.sql",
  "20260906114500_reference_data_version_lifecycle.sql",
  "20260908173000_govern_data_prep_lifecycle.sql",
  "20260908184500_add_data_prep_ui_upsert_wrapper.sql",
  "20260908203000_govern_environment_changes.sql",
];

if (process.env.FVI_ALLOW_ENV_CHANGE_PREPARE !== "YES") {
  throw new Error("Set FVI_ALLOW_ENV_CHANGE_PREPARE=YES");
}
if (!path.isAbsolute(patFile)) {
  throw new Error("FVI_SUPABASE_PAT_FILE must be an absolute protected file");
}
for (const value of [sourceTenantId, targetTenantId]) {
  if (!/^[0-9a-f-]{36}$/u.test(value)) throw new Error("Source and target tenant IDs are required");
}
if (
  !actorRequestTitle ||
  actorRequestTitle.length > 120 ||
  !requestTitle ||
  requestTitle.length > 120
) {
  throw new Error("Valid actor-source and new request titles are required");
}
if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
  throw new Error("Valid idempotency key is required");
}
const accessToken = (await readFile(patFile, "utf8")).trim();
if (!/^sbp_[A-Za-z0-9_-]{20,}$/u.test(accessToken)) {
  throw new Error("Protected Management API token is unavailable");
}

async function query(projectRef, sql, readOnly) {
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

const actorTitle = actorRequestTitle.replaceAll("'", "''");
const actorRows = await query(
  PROD_REF,
  `select requested_by from public.environment_change_requests
   where title='${actorTitle}' order by requested_at desc limit 2`,
  true,
);
if (actorRows.length !== 1 || !/^[0-9a-f-]{36}$/u.test(actorRows[0].requested_by)) {
  throw new Error("Accountable request actor could not be resolved exactly once");
}
const actorUserId = actorRows[0].requested_by;

const exportRows = await query(
  PROD_REF,
  `select jsonb_build_object(
    'package',jsonb_build_object(
      'recon_definitions',coalesce((select jsonb_agg(jsonb_build_object(
        'id',r.id,'recon_code',r.recon_code,'name',r.name,'description',r.description,'recon_type',r.recon_type,
        'rules',r.rules,'sides',r.sides,'extension',r.extension,'visibility',r.visibility
      ) order by r.name,r.id) from public.recon_definitions r where r.tenant_id='${sourceTenantId}'::uuid),'[]'::jsonb),
      'data_prep_pipelines',coalesce((select jsonb_agg(jsonb_build_object(
        'id',p.id,'public_uid',p.public_uid,'name',p.name,'description',p.description,
        'source_data_source_id',p.source_data_source_id,'output_data_source_id',p.output_data_source_id,
        'steps',p.steps,'dq_rules',p.dq_rules,'on_failure',p.on_failure,'enabled',p.enabled,'version',p.version
      ) order by p.name,p.id) from public.data_prep_pipelines p
        where p.tenant_id='${sourceTenantId}'::uuid and p.lifecycle_state<>'archived'),'[]'::jsonb)
    ),
    'configuration',jsonb_build_object(
      'data_sources',coalesce((select jsonb_agg(jsonb_build_object(
        'id',s.id,'name',s.name,'description',s.description,'source_type',s.source_type,
        'status',s.status,'inferred_schema',s.inferred_schema,'sample_rows',s.sample_rows,'row_count',s.row_count
      ) order by s.name,s.id) from public.workspace_data_sources s where s.tenant_id='${sourceTenantId}'::uuid),'[]'::jsonb),
      'connector_schedules',coalesce((select jsonb_agg(jsonb_build_object(
        'id',s.id,'data_source_id',s.data_source_id,'name',s.name,'connector_type',s.connector_type,
        'cron_expression',s.cron_expression,'mode',s.mode,'poll_interval_seconds',s.poll_interval_seconds,
        'transformation',s.transformation,'source_config_hash',
          encode(extensions.digest(convert_to(s.config::text,'UTF8'),'sha256'),'hex'),
        'credential_binding_required',true
      ) order by s.name,s.id) from public.data_source_schedules s where s.tenant_id='${sourceTenantId}'::uuid),'[]'::jsonb),
      'watchers',coalesce((select jsonb_agg(jsonb_build_object(
        'id',w.id,'data_source_id',w.data_source_id,'name',w.name,'watch_type',w.watch_type,
        'severity',w.severity,'config',w.config
      ) order by w.name,w.id) from public.data_watchers w where w.tenant_id='${sourceTenantId}'::uuid),'[]'::jsonb)
    ),
    'settings',jsonb_build_object(
      'family',(select jsonb_build_object('id',f.id,'name',f.name,'allow_skip_uat',false)
        from public.tenant_families f join public.tenants t on t.family_id=f.id where t.id='${sourceTenantId}'::uuid),
      'tenant',(select jsonb_build_object(
        'name','ReconIQ Assurance Lab — DEV','slug','reconiq-assurance-lab-development',
        'environment','dev','region',t.region,'allowed_regions',t.allowed_regions,
        'residency_locked',t.residency_locked,'run_retention_days',t.run_retention_days,
        'agent_max_actions',t.agent_max_actions,'agent_max_distinct_tables',t.agent_max_distinct_tables,
        'ai_enabled',t.ai_enabled
      ) from public.tenants t where t.id='${sourceTenantId}'::uuid),
      'members',coalesce((select jsonb_agg(jsonb_build_object('email',lower(u.email),'role',m.role) order by lower(u.email))
        from public.tenant_members m join auth.users u on u.id=m.user_id
        where m.tenant_id='${sourceTenantId}'::uuid and m.active),'[]'::jsonb),
      'feature_flags',coalesce((select jsonb_agg(jsonb_build_object(
        'feature_key',f.feature_key,'enabled',f.enabled,'config',f.config
      ) order by f.feature_key) from public.tenant_feature_flags f where f.tenant_id='${sourceTenantId}'::uuid),'[]'::jsonb),
      'workspace_pages',coalesce((select jsonb_agg(jsonb_build_object(
        'page_key',v.page_key,'enabled',v.enabled
      ) order by v.page_key) from public.tenant_workspace_page_visibility v where v.tenant_id='${sourceTenantId}'::uuid),'[]'::jsonb)
    )
  ) as manifest`,
  true,
);
const manifest = exportRows[0]?.manifest;
if (!manifest?.package || !manifest?.configuration || !manifest?.settings) {
  throw new Error("Secret-free source manifest export failed");
}
manifest.package.schema_migrations = await Promise.all(
  schemaMigrationFiles.map(async (filename) => {
    const sql = await readFile(path.resolve("supabase/migrations", filename), "utf8");
    return {
      version: filename.slice(0, 14),
      name: filename.slice(15, -4),
      sha256: createHash("sha256").update(sql).digest("hex"),
    };
  }),
);

function assertSafe(value, pathName = "manifest") {
  if (typeof value === "string") {
    if (
      /(sbp_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/u.test(
        value,
      ) ||
      /:\/\/[^/@\s]+:[^/@\s]+@/u.test(value)
    ) {
      throw new Error(`Credential-shaped value rejected at ${pathName}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSafe(entry, `${pathName}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (
      /(password|secret|access[_ -]?token|refresh[_ -]?token|private[_ -]?key|service[_ -]?role|connection[_ -]?string)/iu.test(
        key,
      )
    ) {
      throw new Error(`Credential-shaped key rejected at ${pathName}`);
    }
    assertSafe(entry, `${pathName}.${key}`);
  }
}
assertSafe(manifest);

const requestPayload = {
  control_tenant_id: sourceTenantId,
  direction: "prod_to_dev",
  source_project_ref: PROD_REF,
  source_tenant_id: sourceTenantId,
  target_project_ref: DEV_REF,
  target_tenant_id: targetTenantId,
  title: requestTitle,
  reason:
    "Create the DEV assurance environment from the accepted PROD package, configuration and settings baseline.",
  manifest,
  idempotency_key: idempotencyKey,
};
const escapedPayload = JSON.stringify(requestPayload).replaceAll("'", "''");
const created = await query(
  PROD_REF,
  `select * from public.request_environment_change_for_api(
    '${escapedPayload}'::jsonb,'${actorUserId}'::uuid)`,
  false,
);
if (created.length !== 1) throw new Error("Governed full-package request creation failed");
console.log(
  JSON.stringify({
    ok: true,
    change_request_uid: created[0].change_request_uid,
    request_status: created[0].request_status,
    manifest_hash: created[0].manifest_hash,
    counts: {
      reconciliations: manifest.package.recon_definitions.length,
      data_prep_pipelines: manifest.package.data_prep_pipelines.length,
      data_sources: manifest.configuration.data_sources.length,
      connector_schedules: manifest.configuration.connector_schedules.length,
      watchers: manifest.configuration.watchers.length,
      members: manifest.settings.members.length,
      feature_flags: manifest.settings.feature_flags.length,
      workspace_pages: manifest.settings.workspace_pages.length,
      schema_migrations: manifest.package.schema_migrations.length,
    },
    secrets_exported: false,
  }),
);
