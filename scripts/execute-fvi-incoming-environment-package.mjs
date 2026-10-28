import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const projects = {
  dev: "YOUR_PROJECT_REF",
  prod: "YOUR_PROJECT_REF",
};
const targetEnvironment = process.env.FVI_ENV_CHANGE_TARGET ?? "";
const targetProjectRef = projects[targetEnvironment];
const patFile = process.env.FVI_SUPABASE_PAT_FILE ?? "";
const requestTitle = process.env.FVI_ENV_CHANGE_REQUEST_TITLE ?? "";
const mode = process.env.FVI_ENV_CHANGE_EXECUTION_MODE ?? "plan";

if (!targetProjectRef) throw new Error("FVI_ENV_CHANGE_TARGET must be dev or prod");
if (!path.isAbsolute(patFile)) throw new Error("Protected Management API token path is required");
if (!requestTitle || requestTitle.length > 120) throw new Error("Exact request title is required");
if (!["plan", "execute"].includes(mode)) throw new Error("Execution mode must be plan or execute");
if (mode === "execute" && process.env.FVI_ALLOW_ENV_CHANGE_EXECUTION !== "YES") {
  throw new Error("Set FVI_ALLOW_ENV_CHANGE_EXECUTION=YES for an approved installation");
}
const accessToken = (await readFile(patFile, "utf8")).trim();
if (!/^sbp_[A-Za-z0-9_-]{20,}$/u.test(accessToken)) {
  throw new Error("Protected Management API token is unavailable");
}

async function query(sql, readOnly) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${targetProjectRef}/database/query`,
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

const escapedTitle = requestTitle.replaceAll("'", "''");
const rows = await query(
  `select id,change_request_uid,status,approval_stage,direction,source_project_ref,source_tenant_id,
    source_environment,target_project_ref,target_tenant_id,target_environment,requested_by,decided_by,
    manifest,manifest_hash,access_mapping_preview,access_mapping_confirmed_at
   from public.environment_change_requests where title='${escapedTitle}' order by requested_at desc limit 2`,
  true,
);
if (rows.length !== 1) throw new Error("Incoming package must resolve exactly once");
const request = rows[0];
if (
  request.status !== "approved" ||
  request.approval_stage !== "target_review" ||
  request.target_project_ref !== targetProjectRef ||
  request.target_environment !== targetEnvironment ||
  !request.access_mapping_confirmed_at
) {
  throw new Error("Target approval and access-mapping confirmation are required");
}
if (request.requested_by === request.decided_by)
  throw new Error("Target four-eyes proof is invalid");
const manifest = request.manifest;
if (!manifest?.package || !manifest?.configuration || !manifest?.settings) {
  throw new Error("Incoming manifest is incomplete");
}
const collections = {
  reconciliations: manifest.package.recon_definitions ?? [],
  dataPrep: manifest.package.data_prep_pipelines ?? [],
  dataSources: manifest.configuration.data_sources ?? [],
  connectors: manifest.configuration.connector_schedules ?? [],
  watchers: manifest.configuration.watchers ?? [],
  featureFlags: manifest.settings.feature_flags ?? [],
  workspacePages: manifest.settings.workspace_pages ?? [],
  mappings: request.access_mapping_preview?.mappings ?? [],
};
for (const value of Object.values(collections)) {
  if (!Array.isArray(value)) throw new Error("Incoming manifest collection is invalid");
}
const exactMappings = collections.mappings.filter((mapping) => mapping?.state === "exact");
const unresolvedMappings = collections.mappings.length - exactMappings.length;
const plan = {
  ok: true,
  mode,
  target_environment: targetEnvironment,
  change_request_uid: request.change_request_uid,
  manifest_hash: request.manifest_hash,
  counts: Object.fromEntries(
    Object.entries(collections).map(([name, value]) => [name, value.length]),
  ),
  exact_access_mappings: exactMappings.length,
  unresolved_access_mappings: unresolvedMappings,
  members_copied: 0,
  credentials_copied: 0,
};
if (mode === "plan") {
  console.log(JSON.stringify(plan));
} else {
  const executionId = `envexec-${randomBytes(12).toString("hex")}`;
  await query(
    `select public.start_environment_change_execution_for_api(
    '${request.id}'::uuid,'${executionId}','${request.requested_by}'::uuid)`,
    false,
  );

  const manifestLiteral = JSON.stringify(manifest).replaceAll("'", "''");
  const mappingLiteral = JSON.stringify(request.access_mapping_preview ?? {}).replaceAll("'", "''");
  const targetTenant = request.target_tenant_id;
  const reconEnvironment = targetEnvironment === "prod" ? "production" : "development";
  const targetSql = `begin;
create temp table fvi_environment_manifest(m jsonb,mapping jsonb) on commit drop;
insert into fvi_environment_manifest values ('${manifestLiteral}'::jsonb,'${mappingLiteral}'::jsonb);

do $$
begin
  if exists(
    select 1 from public.workspace_data_sources x,fvi_environment_manifest f,
      jsonb_to_recordset(f.m->'configuration'->'data_sources') s(id uuid)
    where x.id=s.id and x.tenant_id<>'${targetTenant}'::uuid
  ) or exists(
    select 1 from public.data_prep_pipelines x,fvi_environment_manifest f,
      jsonb_to_recordset(f.m->'package'->'data_prep_pipelines') p(id uuid)
    where x.id=p.id and x.tenant_id<>'${targetTenant}'::uuid
  ) or exists(
    select 1 from public.recon_definitions x,fvi_environment_manifest f,
      jsonb_to_recordset(f.m->'package'->'recon_definitions') r(id uuid)
    where x.id=r.id and x.tenant_id<>'${targetTenant}'::uuid
  ) then raise exception 'Cross-tenant package identifier collision'; end if;
end $$;

insert into public.workspace_data_sources(
  id,tenant_id,name,description,source_type,status,inferred_schema,sample_rows,row_count,connection_config,created_by
)
select s.id,'${targetTenant}'::uuid,s.name,s.description,s.source_type,s.status,
  coalesce(s.inferred_schema,'{}'::jsonb),coalesce(s.sample_rows,'[]'::jsonb),coalesce(s.row_count,0),
  '{}'::jsonb,'${request.requested_by}'::uuid
from fvi_environment_manifest f,jsonb_to_recordset(f.m->'configuration'->'data_sources') as s(
  id uuid,name text,description text,source_type text,status text,inferred_schema jsonb,sample_rows jsonb,row_count integer
)
on conflict (id) do nothing;

insert into public.data_prep_pipelines(
  id,tenant_id,public_uid,name,description,source_data_source_id,output_data_source_id,
  steps,dq_rules,on_failure,enabled,status,version,lifecycle_state,created_by
)
select p.id,'${targetTenant}'::uuid,p.public_uid,p.name,p.description,p.source_data_source_id,
  p.output_data_source_id,coalesce(p.steps,'[]'::jsonb),coalesce(p.dq_rules,'[]'::jsonb),
  coalesce(p.on_failure,'block'),false,'draft',coalesce(p.version,1),'production','${request.requested_by}'::uuid
from fvi_environment_manifest f,jsonb_to_recordset(f.m->'package'->'data_prep_pipelines') as p(
  id uuid,public_uid text,name text,description text,source_data_source_id uuid,output_data_source_id uuid,
  steps jsonb,dq_rules jsonb,on_failure text,enabled boolean,version integer
)
on conflict (id) do nothing;

insert into public.recon_definitions(
  id,tenant_id,recon_code,name,description,recon_type,rules,sides,extension,visibility,status,environment,created_by
)
select r.id,'${targetTenant}'::uuid,r.recon_code,r.name,r.description,r.recon_type,coalesce(r.rules,'[]'::jsonb),
  coalesce(r.sides,'[]'::jsonb),coalesce(r.extension,'{}'::jsonb),'restricted','draft',
  '${reconEnvironment}','${request.requested_by}'::uuid
from fvi_environment_manifest f,jsonb_to_recordset(f.m->'package'->'recon_definitions') as r(
  id uuid,recon_code text,name text,description text,recon_type text,rules jsonb,sides jsonb,extension jsonb,visibility text
)
on conflict (id) do nothing;

insert into public.data_source_schedules(
  id,tenant_id,data_source_id,name,connector_type,cron_expression,mode,poll_interval_seconds,
  transformation,config,enabled,last_error,created_by
)
select s.id,'${targetTenant}'::uuid,s.data_source_id,s.name,s.connector_type,
  coalesce(s.cron_expression,'0 0 * * *'),coalesce(s.mode,'scheduled'),s.poll_interval_seconds,
  coalesce(s.transformation,'{}'::jsonb),jsonb_build_object(
    'credential_binding_required',true,'source_config_hash',s.source_config_hash
  ),false,'Credential binding required after governed environment migration','${request.requested_by}'::uuid
from fvi_environment_manifest f,jsonb_to_recordset(f.m->'configuration'->'connector_schedules') as s(
  id uuid,data_source_id uuid,name text,connector_type text,cron_expression text,mode text,
  poll_interval_seconds integer,transformation jsonb,source_config_hash text
)
on conflict (id) do nothing;

insert into public.data_watchers(id,tenant_id,data_source_id,name,watch_type,severity,config,enabled,last_state,created_by)
select w.id,'${targetTenant}'::uuid,w.data_source_id,w.name,w.watch_type,coalesce(w.severity,'warning'),
  coalesce(w.config,'{}'::jsonb),false,'unknown','${request.requested_by}'::uuid
from fvi_environment_manifest f,jsonb_to_recordset(f.m->'configuration'->'watchers') as w(
  id uuid,data_source_id uuid,name text,watch_type text,severity text,config jsonb
)
on conflict (id) do nothing;

insert into public.tenant_feature_flags(tenant_id,feature_key,enabled,config,updated_by)
select '${targetTenant}'::uuid,v.feature_key,v.enabled,coalesce(v.config,'{}'::jsonb),'${request.requested_by}'::uuid
from fvi_environment_manifest f,jsonb_to_recordset(f.m->'settings'->'feature_flags') as v(feature_key text,enabled boolean,config jsonb)
on conflict (tenant_id,feature_key) do update set enabled=excluded.enabled,config=excluded.config,updated_by=excluded.updated_by;

insert into public.tenant_workspace_page_visibility(tenant_id,page_key,enabled,updated_by)
select '${targetTenant}'::uuid,v.page_key,v.enabled,'${request.requested_by}'::uuid
from fvi_environment_manifest f,jsonb_to_recordset(f.m->'settings'->'workspace_pages') as v(page_key text,enabled boolean)
on conflict (tenant_id,page_key) do update set enabled=excluded.enabled,updated_by=excluded.updated_by;

insert into public.recon_permissions(recon_id,principal_type,principal_id,permission)
select (m->>'recon_source_id')::uuid,m->>'principal_type',(m->>'target_principal_id')::uuid,m->>'permission'
from fvi_environment_manifest f,jsonb_array_elements(f.mapping->'mappings') m
where m->>'state'='exact'
on conflict (recon_id,principal_type,principal_id,permission) do nothing;

insert into public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
values ('${request.requested_by}'::uuid,'${targetTenant}'::uuid,'platform','environment_change.package_installed',
  'environment_change_request','${request.id}',jsonb_build_object(
    'execution_id','${executionId}','source_project_ref','${request.source_project_ref}',
    'source_tenant_id','${request.source_tenant_id}','manifest_hash','${request.manifest_hash}',
    'members_copied',0,'credentials_copied',0,'exact_access_mappings',${exactMappings.length},
    'unresolved_access_mappings',${unresolvedMappings}
  ));
commit;`;

  let applyError = null;
  try {
    await query(targetSql, false);
  } catch (error) {
    applyError = error;
  }
  if (applyError) {
    const failed = [
      { component: "package", status: "fail", detail: "target_transaction_rolled_back" },
      { component: "configuration", status: "fail", detail: "target_transaction_rolled_back" },
      { component: "settings", status: "skipped", detail: "target_transaction_rolled_back" },
    ];
    await query(
      `select public.complete_environment_change_execution_for_api(
      '${request.id}'::uuid,'failed','${JSON.stringify(failed).replaceAll("'", "''")}'::jsonb,
      null,null,'${request.requested_by}'::uuid)`,
      false,
    );
    throw applyError;
  }

  const readback = (
    await query(
      `select
    (select count(*)::integer from public.recon_definitions where tenant_id='${targetTenant}'::uuid
      and id in (select (value->>'id')::uuid from jsonb_array_elements('${manifestLiteral}'::jsonb->'package'->'recon_definitions'))) as reconciliations,
    (select count(*)::integer from public.data_prep_pipelines where tenant_id='${targetTenant}'::uuid
      and id in (select (value->>'id')::uuid from jsonb_array_elements('${manifestLiteral}'::jsonb->'package'->'data_prep_pipelines'))) as data_prep_pipelines,
    (select count(*)::integer from public.workspace_data_sources where tenant_id='${targetTenant}'::uuid
      and id in (select (value->>'id')::uuid from jsonb_array_elements('${manifestLiteral}'::jsonb->'configuration'->'data_sources'))) as data_sources,
    (select count(*)::integer from public.data_source_schedules where tenant_id='${targetTenant}'::uuid
      and id in (select (value->>'id')::uuid from jsonb_array_elements('${manifestLiteral}'::jsonb->'configuration'->'connector_schedules'))) as connectors,
    (select count(*)::integer from public.data_watchers where tenant_id='${targetTenant}'::uuid
      and id in (select (value->>'id')::uuid from jsonb_array_elements('${manifestLiteral}'::jsonb->'configuration'->'watchers'))) as watchers`,
      true,
    )
  )[0];
  const componentResults = [
    {
      component: "package",
      status:
        readback.reconciliations === collections.reconciliations.length &&
        readback.data_prep_pipelines === collections.dataPrep.length
          ? "pass"
          : "fail",
      expected: {
        reconciliations: collections.reconciliations.length,
        data_prep_pipelines: collections.dataPrep.length,
      },
      actual: {
        reconciliations: readback.reconciliations,
        data_prep_pipelines: readback.data_prep_pipelines,
      },
    },
    {
      component: "configuration",
      status:
        readback.data_sources === collections.dataSources.length &&
        readback.connectors === collections.connectors.length &&
        readback.watchers === collections.watchers.length
          ? "pass"
          : "fail",
      expected: {
        data_sources: collections.dataSources.length,
        connectors: collections.connectors.length,
        watchers: collections.watchers.length,
      },
      actual: readback,
    },
    {
      component: "settings",
      status: "pass",
      exact_access_mappings: exactMappings.length,
      unresolved_access_mappings: unresolvedMappings,
      members_copied: 0,
    },
  ];
  const succeeded = componentResults.every((component) => component.status === "pass");
  const finalReadback = {
    target_project_ref: targetProjectRef,
    target_tenant_id: targetTenant,
    manifest_hash: request.manifest_hash,
    members_copied: 0,
    credentials_copied: 0,
    ...readback,
  };
  await query(
    `select public.complete_environment_change_execution_for_api(
    '${request.id}'::uuid,'${succeeded ? "succeeded" : "failed"}',
    '${JSON.stringify(componentResults).replaceAll("'", "''")}'::jsonb,
    '${JSON.stringify(finalReadback).replaceAll("'", "''")}'::jsonb,null,
    '${request.requested_by}'::uuid)`,
    false,
  );
  console.log(
    JSON.stringify({
      ...plan,
      ok: succeeded,
      execution_id: executionId,
      component_results: componentResults,
      final_readback: finalReadback,
    }),
  );
  if (!succeeded) process.exit(1);
}
