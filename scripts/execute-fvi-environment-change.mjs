import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const PROD_REF = "YOUR_PROJECT_REF";
const DEV_REF = "YOUR_PROJECT_REF";
const patFile = process.env.FVI_SUPABASE_PAT_FILE ?? "";
const requestTitle = process.env.FVI_ENV_CHANGE_REQUEST_TITLE ?? "";
const mode = process.env.FVI_ENV_CHANGE_EXECUTION_MODE ?? "plan";
const schemaMigrations = [
  {
    version: "20260906014500",
    file: "20260906014500_add_connector_agent_queue.sql",
    effect:
      "to_regprocedure('public.claim_connector_agent_job(uuid,uuid,text,integer)') is not null",
  },
  {
    version: "20260906061500",
    file: "20260906061500_harden_data_watchers.sql",
    effect:
      "to_regprocedure('public.record_data_watcher_evaluation(uuid,uuid,text,text,jsonb,text,uuid,numeric,boolean,timestamptz)') is not null",
  },
  {
    version: "20260906110000",
    file: "20260906110000_harden_reference_data_import.sql",
    effect:
      "to_regprocedure('public.bulk_import_reference_data(uuid,uuid,jsonb,boolean)') is not null",
  },
  {
    version: "20260906113000",
    file: "20260906113000_create_reference_data_versions.sql",
    effect: "to_regclass('public.reference_data_versions') is not null",
  },
  {
    version: "20260906114500",
    file: "20260906114500_reference_data_version_lifecycle.sql",
    effect:
      "to_regprocedure('public.stage_reference_data_version(uuid,uuid,jsonb,date,date,text)') is not null",
  },
  {
    version: "20260908173000",
    file: "20260908173000_govern_data_prep_lifecycle.sql",
    effect:
      "to_regprocedure('public.approve_data_prep_pipeline_for_api(uuid,uuid,uuid)') is not null",
  },
  {
    version: "20260908184500",
    file: "20260908184500_add_data_prep_ui_upsert_wrapper.sql",
    effect: "to_regprocedure('public.upsert_data_prep_pipeline(uuid,uuid,jsonb)') is not null",
  },
  {
    version: "20260908203000",
    file: "20260908203000_govern_environment_changes.sql",
    effect: "to_regclass('public.environment_change_requests') is not null",
  },
];
if (!path.isAbsolute(patFile)) throw new Error("Protected Management API token path is required");
if (!requestTitle || requestTitle.length > 120) throw new Error("Exact request title is required");
if (!["plan", "execute"].includes(mode)) throw new Error("Execution mode must be plan or execute");
if (mode === "execute" && process.env.FVI_ALLOW_ENV_CHANGE_EXECUTION !== "YES") {
  throw new Error("Set FVI_ALLOW_ENV_CHANGE_EXECUTION=YES for an approved execution");
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

const escapedTitle = requestTitle.replaceAll("'", "''");
const requests = await query(
  PROD_REF,
  `select id,change_request_uid,status,direction,source_project_ref,source_tenant_id,
    target_project_ref,target_tenant_id,requested_by,decided_by,manifest,manifest_hash
   from public.environment_change_requests where title='${escapedTitle}' order by requested_at desc limit 2`,
  true,
);
if (requests.length !== 1) throw new Error("Approved request must resolve exactly once");
const request = requests[0];
if (
  request.status !== "approved" ||
  request.direction !== "prod_to_dev" ||
  request.source_project_ref !== PROD_REF ||
  request.target_project_ref !== DEV_REF
) {
  throw new Error("This executor currently requires one approved PROD to DEV seed request");
}
for (const value of [
  request.id,
  request.source_tenant_id,
  request.target_tenant_id,
  request.requested_by,
  request.decided_by,
]) {
  if (!/^[0-9a-f-]{36}$/u.test(value)) throw new Error("Approved request identity is invalid");
}
const manifest = request.manifest;
if (!manifest?.package || !manifest?.configuration || !manifest?.settings) {
  throw new Error("Approved request has no complete manifest");
}
const expected = {
  reconciliations: manifest.package.recon_definitions?.length ?? -1,
  data_prep_pipelines: manifest.package.data_prep_pipelines?.length ?? -1,
  data_sources: manifest.configuration.data_sources?.length ?? -1,
  connector_schedules: manifest.configuration.connector_schedules?.length ?? -1,
  watchers: manifest.configuration.watchers?.length ?? -1,
  members: manifest.settings.members?.length ?? -1,
  feature_flags: manifest.settings.feature_flags?.length ?? -1,
  workspace_pages: manifest.settings.workspace_pages?.length ?? -1,
  schema_migrations: manifest.package.schema_migrations?.length ?? -1,
};
if (Object.values(expected).some((value) => !Number.isInteger(value) || value < 0)) {
  throw new Error("Approved manifest collections are incomplete");
}
const approvedSchema = new Map(
  (manifest.package.schema_migrations ?? []).map((entry) => [entry.version, entry]),
);
if (approvedSchema.size !== schemaMigrations.length) {
  throw new Error("Approved schema migration manifest is incomplete");
}
for (const migration of schemaMigrations) {
  const approved = approvedSchema.get(migration.version);
  const sql = await readFile(path.resolve("supabase/migrations", migration.file), "utf8");
  const sha256 = createHash("sha256").update(sql).digest("hex");
  if (!approved || approved.sha256 !== sha256) {
    throw new Error(`Approved schema hash mismatch for ${migration.version}`);
  }
  migration.sql = sql;
  migration.sha256 = sha256;
  migration.name = migration.file.slice(15, -4);
}

const actorRows = await query(
  PROD_REF,
  `select lower(email) as email from auth.users where id='${request.requested_by}'::uuid`,
  true,
);
if (actorRows.length !== 1 || !/^[^'\s@]+@[^'\s@]+$/u.test(actorRows[0].email)) {
  throw new Error("Accountable execution actor email is unavailable");
}
const actorEmail = actorRows[0].email.replaceAll("'", "''");
const targetActors = await query(
  DEV_REF,
  `select id from auth.users where lower(email)='${actorEmail}'`,
  true,
);
if (targetActors.length !== 1) throw new Error("Execution actor does not map exactly once in DEV");
const targetActorId = targetActors[0].id;
if (!/^[0-9a-f-]{36}$/u.test(targetActorId)) throw new Error("Mapped DEV actor ID is invalid");
const sourceMemberEmails = (manifest.settings.members ?? []).map((member) => member?.email);
if (
  sourceMemberEmails.length !== expected.members ||
  sourceMemberEmails.some(
    (email) => typeof email !== "string" || !/^[^'\s@]+@[^'\s@]+$/u.test(email),
  )
) {
  throw new Error("Approved source member mapping is invalid");
}
const sourceMemberEmailSql = sourceMemberEmails
  .map((email) => `'${email.replaceAll("'", "''")}'`)
  .join(",");

const familyId = manifest.settings.family?.id;
const familyName = manifest.settings.family?.name;
const targetSlug = manifest.settings.tenant?.slug;
const targetName = manifest.settings.tenant?.name;
if (
  !/^[0-9a-f-]{36}$/u.test(familyId) ||
  typeof familyName !== "string" ||
  typeof targetSlug !== "string" ||
  typeof targetName !== "string"
) {
  throw new Error("Manifest family is invalid");
}
const safeTargetSlug = targetSlug.replaceAll("'", "''");
const safeTargetName = targetName.replaceAll("'", "''");
const targetReadiness = await query(
  DEV_REF,
  `select
    to_regclass('public.tenants') is not null as tenants,
    to_regclass('public.tenant_members') is not null as members,
    to_regclass('public.workspace_data_sources') is not null as sources,
    to_regclass('public.data_prep_pipelines') is not null as data_prep,
    to_regclass('public.recon_definitions') is not null as reconciliations,
    to_regclass('public.data_source_schedules') is not null as schedules,
    to_regclass('public.data_watchers') is not null as watchers,
    to_regclass('public.tenant_feature_flags') is not null as feature_flags,
    to_regclass('public.tenant_workspace_page_visibility') is not null as workspace_pages,
    exists(select 1 from pg_constraint where conname='recon_definitions_environment_check'
      and pg_get_constraintdef(oid) like '%development%') as recon_environment_vocabulary,
    not exists(select 1 from public.tenants where id='${request.target_tenant_id}'::uuid) as target_absent,
    coalesce((select slug='${safeTargetSlug}' and name='${safeTargetName}' and environment='dev'
      from public.tenants where id='${request.target_tenant_id}'::uuid),true) as target_compatible,
    coalesce((select name='${String(familyName).replaceAll("'", "''")}' from public.tenant_families where id='${familyId}'::uuid),true) as family_compatible`,
  true,
);
const readiness = targetReadiness[0] ?? {};
const readinessChecks = [
  "tenants",
  "members",
  "sources",
  "data_prep",
  "reconciliations",
  "schedules",
  "watchers",
  "feature_flags",
  "workspace_pages",
  "recon_environment_vocabulary",
  "target_compatible",
  "family_compatible",
];
if (readinessChecks.some((key) => readiness[key] !== true)) {
  throw new Error("DEV target schema or collision preflight failed");
}

const plan = {
  ok: true,
  mode,
  change_request_uid: request.change_request_uid,
  direction: request.direction,
  manifest_hash: request.manifest_hash,
  target_absent: readiness.target_absent,
  target_compatible: true,
  family_compatible: true,
  expected,
  credentials_to_copy: 0,
  connector_credentials_require_rebinding: expected.connector_schedules,
};
if (mode === "plan") {
  console.log(JSON.stringify(plan));
  process.exit(0);
}

const executionId = `envexec-${randomBytes(12).toString("hex")}`;
await query(
  PROD_REF,
  `select public.start_environment_change_execution_for_api(
    '${request.id}'::uuid,'${executionId}','${request.requested_by}'::uuid)`,
  false,
);

const schemaResults = [];
let activeSchemaVersion = null;
try {
  for (const migration of schemaMigrations) {
    activeSchemaVersion = migration.version;
    const before = (
      await query(
        DEV_REF,
        `select ${migration.effect} as effect,
          exists(select 1 from supabase_migrations.schema_migrations where version='${migration.version}') as ledgered`,
        true,
      )
    )[0];
    if (before.ledgered) {
      if (!before.effect)
        throw new Error(`Ledgered schema effect is missing for ${migration.version}`);
      schemaResults.push({
        version: migration.version,
        status: "reused",
        sha256: migration.sha256,
      });
      continue;
    }
    if (before.effect) {
      throw new Error(`Schema effect exists without ledger evidence for ${migration.version}`);
    }
    const marker =
      `Applied by governed FVI environment delivery; sha256=${migration.sha256}`.replaceAll(
        "'",
        "''",
      );
    await query(
      DEV_REF,
      `begin;\n${migration.sql}\ninsert into supabase_migrations.schema_migrations(version,name,statements)
       values ('${migration.version}','${migration.name}',array['${marker}']);\ncommit;`,
      false,
    );
    const after = (
      await query(
        DEV_REF,
        `select ${migration.effect} as effect,
          exists(select 1 from supabase_migrations.schema_migrations where version='${migration.version}') as ledgered`,
        true,
      )
    )[0];
    if (!after.effect || !after.ledgered) {
      throw new Error(`Schema migration readback failed for ${migration.version}`);
    }
    schemaResults.push({ version: migration.version, status: "applied", sha256: migration.sha256 });
  }
} catch (error) {
  const componentResults = [
    { component: "package", status: "skipped", detail: "schema_migration_failed" },
    {
      component: "configuration",
      status: "fail",
      detail: "schema_migration_failed",
      failed_version: activeSchemaVersion,
      schema_results: schemaResults,
    },
    { component: "settings", status: "skipped", detail: "schema_migration_failed" },
  ];
  const escapedResults = JSON.stringify(componentResults).replaceAll("'", "''");
  await query(
    PROD_REF,
    `select public.complete_environment_change_execution_for_api(
      '${request.id}'::uuid,'failed','${escapedResults}'::jsonb,null,null,'${request.requested_by}'::uuid)`,
    false,
  );
  throw error;
}

const manifestLiteral = JSON.stringify(manifest).replaceAll("'", "''");
const targetTenant = request.target_tenant_id;
const safeFamilyName = String(familyName).replaceAll("'", "''");
const targetSql = `begin;
create temp table fvi_environment_manifest(m jsonb) on commit drop;
insert into fvi_environment_manifest values ('${manifestLiteral}'::jsonb);

insert into public.tenant_families(id,name,allow_skip_uat,created_by)
values ('${familyId}'::uuid,'${safeFamilyName}',false,'${targetActorId}'::uuid)
on conflict (id) do nothing;

insert into public.tenants(
  id,slug,name,family_id,environment,region,allowed_regions,residency_locked,
  run_retention_days,agent_max_actions,agent_max_distinct_tables,ai_enabled,created_by
)
select '${targetTenant}'::uuid,t->>'slug',t->>'name','${familyId}'::uuid,'dev'::public.env_tier,
  coalesce(t->>'region','IN'),coalesce(array(select jsonb_array_elements_text(t->'allowed_regions')),array['IN']),
  coalesce((t->>'residency_locked')::boolean,false),coalesce((t->>'run_retention_days')::integer,90),
  coalesce((t->>'agent_max_actions')::integer,10),coalesce((t->>'agent_max_distinct_tables')::integer,5),
  coalesce((t->>'ai_enabled')::boolean,false),'${targetActorId}'::uuid
from (select m->'settings'->'tenant' t from fvi_environment_manifest) q;

insert into public.tenant_members(tenant_id,user_id,role,invited_by,added_by_platform,active)
select '${targetTenant}'::uuid,u.id,m.role::public.tenant_role,'${targetActorId}'::uuid,true,true
from fvi_environment_manifest f,
  jsonb_to_recordset(f.m->'settings'->'members') as m(email text,role text)
join auth.users u on lower(u.email)=lower(m.email)
on conflict (tenant_id,user_id) do update set
  role=excluded.role,active=true,deactivated_at=null,added_by_platform=true;

insert into public.rbac_user_grants(tenant_id,user_id,role_id,scope_type,scope_id,granted_by,reason)
select '${targetTenant}'::uuid,u.id,r.id,'tenant'::public.rbac_scope_type,null,'${targetActorId}'::uuid,
  'Governed environment seed '||'${executionId}'
from fvi_environment_manifest f,
  jsonb_to_recordset(f.m->'settings'->'members') as m(email text,role text)
join auth.users u on lower(u.email)=lower(m.email)
join public.rbac_roles r on r.key=m.role and r.is_system
where not exists(select 1 from public.rbac_user_grants g
  where g.tenant_id='${targetTenant}'::uuid and g.user_id=u.id and g.role_id=r.id and g.revoked_at is null);

insert into public.workspace_data_sources(
  id,tenant_id,name,description,source_type,status,inferred_schema,sample_rows,row_count,
  connection_config,created_by
)
select s.id,'${targetTenant}'::uuid,s.name,s.description,s.source_type,s.status,
  coalesce(s.inferred_schema,'{}'::jsonb),coalesce(s.sample_rows,'[]'::jsonb),coalesce(s.row_count,0),
  '{}'::jsonb,'${targetActorId}'::uuid
from fvi_environment_manifest f,
  jsonb_to_recordset(f.m->'configuration'->'data_sources') as s(
    id uuid,name text,description text,source_type text,status text,inferred_schema jsonb,sample_rows jsonb,row_count integer
  );

insert into public.data_prep_pipelines(
  id,tenant_id,public_uid,name,description,source_data_source_id,output_data_source_id,
  steps,dq_rules,on_failure,enabled,status,version,lifecycle_state,created_by
)
select p.id,'${targetTenant}'::uuid,p.public_uid,p.name,p.description,p.source_data_source_id,
  p.output_data_source_id,coalesce(p.steps,'[]'::jsonb),coalesce(p.dq_rules,'[]'::jsonb),
  coalesce(p.on_failure,'block'),false,'draft',coalesce(p.version,1),'production','${targetActorId}'::uuid
from fvi_environment_manifest f,
  jsonb_to_recordset(f.m->'package'->'data_prep_pipelines') as p(
    id uuid,public_uid text,name text,description text,source_data_source_id uuid,output_data_source_id uuid,
    steps jsonb,dq_rules jsonb,on_failure text,enabled boolean,version integer
  );

insert into public.recon_definitions(
  id,tenant_id,recon_code,name,description,recon_type,rules,sides,extension,visibility,status,environment,created_by
)
select r.id,'${targetTenant}'::uuid,r.recon_code,r.name,r.description,r.recon_type,coalesce(r.rules,'[]'::jsonb),
  coalesce(r.sides,'[]'::jsonb),coalesce(r.extension,'{}'::jsonb),coalesce(r.visibility,'private'),
  'draft','development','${targetActorId}'::uuid
from fvi_environment_manifest f,
  jsonb_to_recordset(f.m->'package'->'recon_definitions') as r(
    id uuid,recon_code text,name text,description text,recon_type text,rules jsonb,sides jsonb,extension jsonb,visibility text
  );

insert into public.data_source_schedules(
  id,tenant_id,data_source_id,name,connector_type,cron_expression,mode,poll_interval_seconds,
  transformation,config,enabled,last_error,created_by
)
select s.id,'${targetTenant}'::uuid,s.data_source_id,s.name,s.connector_type,
  coalesce(s.cron_expression,'0 0 * * *'),coalesce(s.mode,'scheduled'),s.poll_interval_seconds,
  coalesce(s.transformation,'{}'::jsonb),jsonb_build_object(
    'credential_binding_required',true,'source_config_hash',s.source_config_hash
  ),false,'Credential binding required after governed environment migration','${targetActorId}'::uuid
from fvi_environment_manifest f,
  jsonb_to_recordset(f.m->'configuration'->'connector_schedules') as s(
    id uuid,data_source_id uuid,name text,connector_type text,cron_expression text,mode text,
    poll_interval_seconds integer,transformation jsonb,source_config_hash text
  );

insert into public.data_watchers(
  id,tenant_id,data_source_id,name,watch_type,severity,config,enabled,last_state,created_by
)
select w.id,'${targetTenant}'::uuid,w.data_source_id,w.name,w.watch_type,coalesce(w.severity,'warning'),
  coalesce(w.config,'{}'::jsonb),false,'unknown','${targetActorId}'::uuid
from fvi_environment_manifest f,
  jsonb_to_recordset(f.m->'configuration'->'watchers') as w(
    id uuid,data_source_id uuid,name text,watch_type text,severity text,config jsonb
  );

insert into public.tenant_feature_flags(tenant_id,feature_key,enabled,config,updated_by)
select '${targetTenant}'::uuid,v.feature_key,v.enabled,coalesce(v.config,'{}'::jsonb),'${targetActorId}'::uuid
from fvi_environment_manifest f,
  jsonb_to_recordset(f.m->'settings'->'feature_flags') as v(feature_key text,enabled boolean,config jsonb)
on conflict (tenant_id,feature_key) do update set enabled=excluded.enabled,config=excluded.config,updated_by=excluded.updated_by;

insert into public.tenant_workspace_page_visibility(tenant_id,page_key,enabled,updated_by)
select '${targetTenant}'::uuid,v.page_key,v.enabled,'${targetActorId}'::uuid
from fvi_environment_manifest f,
  jsonb_to_recordset(f.m->'settings'->'workspace_pages') as v(page_key text,enabled boolean)
on conflict (tenant_id,page_key) do update set enabled=excluded.enabled,updated_by=excluded.updated_by;

insert into public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
values ('${targetActorId}'::uuid,'${targetTenant}'::uuid,'platform','environment_change.seeded_from_prod',
  'tenant','${targetTenant}',jsonb_build_object(
    'execution_id','${executionId}','source_project_ref','${PROD_REF}',
    'source_tenant_id','${request.source_tenant_id}','manifest_hash','${request.manifest_hash}',
    'credentials_copied',false,'connector_rebinding_required',${expected.connector_schedules}
  ));
commit;`;

let applyError = null;
if (readiness.target_absent) {
  try {
    await query(DEV_REF, targetSql, false);
  } catch (error) {
    applyError = error;
  }
} else {
  await query(
    DEV_REF,
    `insert into public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
     values ('${targetActorId}'::uuid,'${request.target_tenant_id}'::uuid,'platform',
       'environment_change.revalidated','tenant','${request.target_tenant_id}',jsonb_build_object(
         'execution_id','${executionId}','manifest_hash','${request.manifest_hash}',
         'credentials_copied',false,'existing_target',true))`,
    false,
  );
}

if (applyError) {
  const componentResults = [
    { component: "package", status: "fail", detail: "target_transaction_rolled_back" },
    {
      component: "configuration",
      status: "fail",
      detail: "target_transaction_rolled_back_after_schema",
      schema_results: schemaResults,
    },
    { component: "settings", status: "skipped", detail: "target_transaction_rolled_back" },
  ];
  const escapedResults = JSON.stringify(componentResults).replaceAll("'", "''");
  await query(
    PROD_REF,
    `select public.complete_environment_change_execution_for_api(
      '${request.id}'::uuid,'failed','${escapedResults}'::jsonb,null,null,'${request.requested_by}'::uuid)`,
    false,
  );
  throw applyError;
}

const readbackRows = await query(
  DEV_REF,
  `select
    exists(select 1 from public.tenants where id='${targetTenant}'::uuid and environment='dev') as tenant,
    (select count(*)::integer from public.tenant_members where tenant_id='${targetTenant}'::uuid and active) as members,
    (select count(*)::integer from public.tenant_members m join auth.users u on u.id=m.user_id
      where m.tenant_id='${targetTenant}'::uuid and m.active and lower(u.email) in (${sourceMemberEmailSql})) as mapped_source_members,
    (select count(*)::integer from public.workspace_data_sources where tenant_id='${targetTenant}'::uuid) as data_sources,
    (select count(*)::integer from public.data_prep_pipelines where tenant_id='${targetTenant}'::uuid) as data_prep_pipelines,
    (select count(*)::integer from public.recon_definitions where tenant_id='${targetTenant}'::uuid) as reconciliations,
    (select count(*)::integer from public.data_source_schedules where tenant_id='${targetTenant}'::uuid) as connector_schedules,
    (select count(*)::integer from public.data_source_schedules where tenant_id='${targetTenant}'::uuid and not enabled
      and config->>'credential_binding_required'='true') as connectors_rebinding,
    (select count(*)::integer from public.data_watchers where tenant_id='${targetTenant}'::uuid and not enabled) as watchers,
    (select count(*)::integer from public.tenant_feature_flags where tenant_id='${targetTenant}'::uuid) as feature_flags,
    (select count(*)::integer from public.tenant_workspace_page_visibility where tenant_id='${targetTenant}'::uuid) as workspace_pages,
    (select count(*)::integer from supabase_migrations.schema_migrations where version in
      (${schemaMigrations.map((migration) => `'${migration.version}'`).join(",")})) as schema_migrations`,
  true,
);
const readback = readbackRows[0];
const componentResults = [
  {
    component: "package",
    status:
      readback.reconciliations === expected.reconciliations &&
      readback.data_prep_pipelines === expected.data_prep_pipelines
        ? "pass"
        : "fail",
    expected: {
      reconciliations: expected.reconciliations,
      data_prep_pipelines: expected.data_prep_pipelines,
    },
    actual: {
      reconciliations: readback.reconciliations,
      data_prep_pipelines: readback.data_prep_pipelines,
    },
  },
  {
    component: "configuration",
    status:
      readback.data_sources === expected.data_sources &&
      readback.connector_schedules === expected.connector_schedules &&
      readback.connectors_rebinding === expected.connector_schedules &&
      readback.watchers === expected.watchers &&
      readback.schema_migrations === expected.schema_migrations
        ? "pass"
        : "fail",
    expected: {
      data_sources: expected.data_sources,
      connector_schedules: expected.connector_schedules,
      watchers: expected.watchers,
      schema_migrations: expected.schema_migrations,
    },
    actual: {
      data_sources: readback.data_sources,
      connector_schedules: readback.connector_schedules,
      connectors_rebinding: readback.connectors_rebinding,
      watchers: readback.watchers,
      schema_migrations: readback.schema_migrations,
      schema_results: schemaResults,
    },
  },
  {
    component: "settings",
    status:
      readback.tenant === true &&
      readback.members >= expected.members &&
      readback.mapped_source_members === expected.members &&
      readback.feature_flags === expected.feature_flags &&
      readback.workspace_pages === expected.workspace_pages
        ? "pass"
        : "fail",
    expected: {
      members: expected.members,
      feature_flags: expected.feature_flags,
      workspace_pages: expected.workspace_pages,
    },
    actual: {
      tenant: readback.tenant,
      members: readback.members,
      mapped_source_members: readback.mapped_source_members,
      platform_seeded_members: readback.members - readback.mapped_source_members,
      feature_flags: readback.feature_flags,
      workspace_pages: readback.workspace_pages,
    },
  },
];
const succeeded = componentResults.every((component) => component.status === "pass");
const escapedResults = JSON.stringify(componentResults).replaceAll("'", "''");
const finalReadback = {
  target_project_ref: DEV_REF,
  target_tenant_id: targetTenant,
  manifest_hash: request.manifest_hash,
  credentials_copied: false,
  ...readback,
};
const escapedReadback = JSON.stringify(finalReadback).replaceAll("'", "''");
await query(
  PROD_REF,
  `select public.complete_environment_change_execution_for_api(
    '${request.id}'::uuid,'${succeeded ? "succeeded" : "failed"}',
    '${escapedResults}'::jsonb,'${escapedReadback}'::jsonb,null,'${request.requested_by}'::uuid)`,
  false,
);
console.log(
  JSON.stringify({
    ok: succeeded,
    mode,
    change_request_uid: request.change_request_uid,
    execution_id: executionId,
    component_results: componentResults,
    final_readback: finalReadback,
  }),
);
if (!succeeded) process.exit(1);
