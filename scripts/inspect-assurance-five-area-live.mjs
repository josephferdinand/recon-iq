// Read-only, exact-tenant inventory for the owner-authorized synthetic five-area QA setup.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCanonicalVault } from "./preflight-fvi-resource-identity-release.mjs";

const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Set FVI_VAULT_PATH to the canonical secured vault");
}
const token = parseCanonicalVault(await readFile(vaultPath, "utf8"));
const project = "YOUR_PROJECT_REF";
const tenant = "aa5ed999-69eb-41a0-a9c6-fbb439efcffb";
const sql = `with target as (
  select id from public.tenants where id='${tenant}' and slug='reconiq-assurance-lab-prod'
)
select jsonb_build_object(
  'tenant_ok', exists(select 1 from target),
  'ledger', (select max(version::text) from supabase_migrations.schema_migrations),
  'units', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'parent_id',parent_id,'archived',is_archived) order by code),'[]'::jsonb) from public.business_units where tenant_id=(select id from target)),
  'groups', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'bu_id',bu_id,'is_system',is_system,'preset_key',preset_key) order by name),'[]'::jsonb) from public.tenant_groups where tenant_id=(select id from target)),
  'group_assignments', (select coalesce(jsonb_agg(jsonb_build_object('bu_id',bu_id,'group_id',group_id,'role',role,'inherit_descendants',inherit_descendants) order by bu_id,group_id),'[]'::jsonb) from public.bu_group_assignments where tenant_id=(select id from target)),
  'source_columns', (select coalesce(jsonb_agg(column_name order by ordinal_position),'[]'::jsonb) from information_schema.columns where table_schema='public' and table_name='workspace_data_sources'),
  'pipeline_columns', (select coalesce(jsonb_agg(column_name order by ordinal_position),'[]'::jsonb) from information_schema.columns where table_schema='public' and table_name='data_prep_pipelines'),
  'registry_columns', (select coalesce(jsonb_agg(column_name order by ordinal_position),'[]'::jsonb) from information_schema.columns where table_schema='public' and table_name='data_resource_registry'),
  'sources', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'bu_id',bu_id,'created_at',created_at) order by name),'[]'::jsonb) from public.workspace_data_sources where tenant_id=(select id from target)),
  'pipelines', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'bu_id',bu_id,'source_id',source_data_source_id,'output_id',output_data_source_id,'created_at',created_at) order by name),'[]'::jsonb) from public.data_prep_pipelines where tenant_id=(select id from target)),
  'recons', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',recon_code,'name',name,'bu_id',bu_id,'status',status) order by recon_code),'[]'::jsonb) from public.recon_definitions where tenant_id=(select id from target)),
  'recon_owners', (select coalesce(jsonb_agg(jsonb_build_object('recon_id',recon_id,'bu_id',bu_id) order by recon_id,bu_id),'[]'::jsonb) from public.recon_definition_business_units where tenant_id=(select id from target)),
  'resource_owners', (select coalesce(jsonb_agg(jsonb_build_object('resource_type',resource_type,'resource_id',resource_id,'bu_id',bu_id) order by resource_type,resource_id,bu_id),'[]'::jsonb) from public.data_resource_business_unit_owners where tenant_id=(select id from target))
  ,'registry', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'resource_type',resource_type,'data_source_id',data_source_id,'data_prep_pipeline_id',data_prep_pipeline_id) order by resource_type,id),'[]'::jsonb) from public.data_resource_registry where tenant_id=(select id from target) and resource_type in ('data_source','data_prep_pipeline'))
  ,'registry_owners', (select coalesce(jsonb_agg(jsonb_build_object('registry_id',registry_id,'bu_id',bu_id) order by registry_id,bu_id),'[]'::jsonb) from public.data_resource_registry_owner_bu where tenant_id=(select id from target))
  ,'registry_grants', (select count(*) from public.data_resource_registry_grants where tenant_id=(select id from target))
  ,'recon_grants', (select count(*) from public.recon_definition_bu_grants where tenant_id=(select id from target))
  ,'phase1_group_members', (select count(*) from public.tenant_group_members gm join public.tenant_groups g on g.id=gm.group_id where g.tenant_id=(select id from target) and g.name in ('Assurance QA — FA','Assurance QA — TA','Assurance QA — IOO','Assurance QA — PCA','Assurance QA — HFS'))
  ,'phase1_group_roles', (select count(*) from public.tenant_group_roles gr join public.tenant_groups g on g.id=gr.group_id where g.tenant_id=(select id from target) and g.name in ('Assurance QA — FA','Assurance QA — TA','Assurance QA — IOO','Assurance QA — PCA','Assurance QA — HFS'))
  ,'phase1_audits', (select coalesce(jsonb_agg(jsonb_build_object('action',action,'count',n) order by action),'[]'::jsonb) from (select action,count(*) n from public.audit_log where tenant_id=(select id from target) and actor_user_id='35c27858-e96d-48e3-8bad-1861826a33a7' and context->>'synthetic'='true' and context->>'area' in ('FA','TA','IOO','PCA','HFS') and action in ('bu.create','group.create','bu.assign_group') group by action) a)
  ,'shared_audits', (select coalesce(jsonb_agg(jsonb_build_object('action',action,'count',n) order by action),'[]'::jsonb) from (select action,count(*) n from public.audit_log where tenant_id=(select id from target) and actor_user_id='35c27858-e96d-48e3-8bad-1861826a33a7' and context->>'synthetic'='true' and context->>'area'='FA+TA' and action in ('group.create','bu.assign_group') group by action) a)
) as state`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ query: sql, read_only: true }),
  signal: AbortSignal.timeout(25_000),
});
if (!response.ok) throw new Error(`Read-only inventory failed: HTTP ${response.status}`);
const state = (await response.json())?.[0]?.state;
if (!state?.tenant_ok) throw new Error("Exact Assurance PROD tenant missing");
if (process.argv.includes("--plan")) {
  const byCode = new Map(state.units.map((unit) => [unit.code, unit]));
  const byName = (rows, name) => {
    const hits = rows.filter((row) => row.name === name);
    if (hits.length !== 1) throw new Error(`Expected one synthetic fixture named ${name}; found ${hits.length}`);
    return hits[0];
  };
  const byReconCode = (code) => {
    const hits = state.recons.filter((row) => row.code === code);
    if (hits.length !== 1) throw new Error(`Expected one synthetic reconciliation ${code}`);
    return hits[0];
  };
  const fixtures = [
    { area: "FA", bu_code: "QA-FUND", group: "Assurance QA — FA", source: "Assurance S4A — Fund administrator positions", pipeline: "Assurance DP5 — Normalize fund administrator positions", recon: "FVI-GEN-2WAY-000003" },
    { area: "TA", bu_code: "QA-TA", group: "Assurance QA — TA", source: "Assurance S4B — Custodian positions", pipeline: "Assurance DP6 — Standardize custody positions", recon: "FVI-GEN-2WAY-000003" },
    { area: "IOO", bu_code: "QA-IOO", group: "Assurance QA — IOO", source: "Assurance S9B — Entity B intercompany ledger", pipeline: "Assurance DP11 — Normalize intercompany counter-entry signs", recon: "FVI-GEN-3WAY-000004" },
    { area: "PCA", bu_code: "QA-PCA", group: "Assurance QA — PCA", source: "Assurance S5A — Internal trades", pipeline: "Assurance DP7 — Normalize internal trade capture", recon: "FVI-GEN-3WAY-000001" },
    { area: "HFS", bu_code: "QA-HFS", group: "Assurance QA — HFS", source: "Assurance S5B — Broker confirmations", pipeline: "Assurance DP8 — Normalize broker confirmations", recon: "FVI-GEN-3WAY-000001" },
  ];
  const plan = fixtures.map((item) => {
    const source = byName(state.sources, item.source);
    const pipeline = byName(state.pipelines, item.pipeline);
    const recon = byReconCode(item.recon);
    if (pipeline.source_id !== source.id) throw new Error(`Pipeline source changed for ${item.area}`);
    const ownerIds = state.recon_owners.filter((owner) => owner.recon_id === recon.id).map((owner) => owner.bu_id);
    if (ownerIds.length !== 1) throw new Error(`Expected one prior reconciliation owner for ${item.area}`);
    const existingGroup = state.groups.filter((group) => group.name === item.group);
    if (existingGroup.length > 1) throw new Error(`Duplicate QA group for ${item.area}`);
    return {
      area: item.area, bu_code: item.bu_code, bu_id: byCode.get(item.bu_code)?.id ?? null,
      group: item.group, group_id: existingGroup[0]?.id ?? null,
      source_id: source.id, pipeline_id: pipeline.id, pipeline_source_verified: true,
      recon_code: item.recon, recon_id: recon.id, preserve_recon_owner_ids: ownerIds,
      synthetic_test_allocation: true,
    };
  });
  if (state.ledger !== "20260924235350" || state.registry.length !== 0 || state.registry_grants !== 0) {
    throw new Error("Ledger or typed-resource registration changed; review plan before writing");
  }
  console.log(JSON.stringify({ tenant, project, ledger: state.ledger, plan,
    phase1_proof: { audits: state.phase1_audits, shared_audits: state.shared_audits,
      shared_group: state.groups.find((group) => group.name === "Assurance QA — FA + TA Shared") ?? null,
      shared_assignments: state.group_assignments.filter((row) => row.group_id === state.groups.find((group) => group.name === "Assurance QA — FA + TA Shared")?.id),
      group_members: state.phase1_group_members,
      group_roles: state.phase1_group_roles, typed_registry_count: state.registry.length,
      typed_grants: state.registry_grants, recon_owner_links: state.recon_owners.length,
      recon_grants: state.recon_grants },
    note: "Synthetic QA allocation only; labels do not assert operational domain ownership." }, null, 2));
  process.exit(0);
}
console.log(JSON.stringify(state, null, 2));
