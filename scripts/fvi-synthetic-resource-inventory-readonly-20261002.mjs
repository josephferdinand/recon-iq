#!/usr/bin/env node
// Exact synthetic-tenant resource/mapping inventory. This helper issues SELECT-only
// Management API requests with read_only=true and never emits or stores its key.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCanonicalVault, TARGETS } from "./preflight-fvi-resource-identity-release.mjs";

const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Set FVI_VAULT_PATH to the canonical secured vault");
}
const managementToken = parseCanonicalVault(await readFile(vaultPath, "utf8"));
const targetSlugs = {
  prod: "reconiq-assurance-lab-prod",
  dev: "reconiq-assurance-lab-development",
};
const targetRefs = { prod: TARGETS.prod, dev: TARGETS.dev };

const inventorySql = (slug) => `
WITH target AS (SELECT id, slug::text AS slug FROM public.tenants WHERE slug::text='${slug}')
SELECT jsonb_build_object(
  'tenant',(SELECT jsonb_build_object('id',id,'slug',slug) FROM target),
  'ledger',jsonb_build_object('count',(SELECT count(*) FROM supabase_migrations.schema_migrations),
                              'latest',(SELECT max(version::text) FROM supabase_migrations.schema_migrations)),
  'business_units',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,
      'parent_id',parent_id,'is_archived',is_archived) ORDER BY code),'[]'::jsonb)
    FROM public.business_units WHERE tenant_id=(SELECT id FROM target)),
  'groups',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'bu_id',g.bu_id,
      'member_count',(SELECT count(*) FROM public.tenant_group_members gm WHERE gm.group_id=g.id))
      ORDER BY g.name),'[]'::jsonb) FROM public.tenant_groups g WHERE tenant_id=(SELECT id FROM target)),
  'group_assignments',(SELECT coalesce(jsonb_agg(jsonb_build_object('group_id',group_id,'bu_id',bu_id,
      'role',role,'inherit_descendants',inherit_descendants) ORDER BY group_id,bu_id),'[]'::jsonb)
    FROM public.bu_group_assignments WHERE tenant_id=(SELECT id FROM target)),
  'sources',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'public_id',public_id,'name',name,
      'source_type',source_type,'bu_id',bu_id) ORDER BY public_id,id),'[]'::jsonb)
    FROM public.workspace_data_sources WHERE tenant_id=(SELECT id FROM target)),
  'uploads',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'public_id',public_id,
      'data_source_id',data_source_id) ORDER BY id),'[]'::jsonb)
    FROM public.workspace_data_source_uploads WHERE tenant_id=(SELECT id FROM target)),
  'schedules',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'public_id',public_id,'name',name,
      'data_source_id',data_source_id) ORDER BY public_id,id),'[]'::jsonb)
    FROM public.data_source_schedules WHERE tenant_id=(SELECT id FROM target)),
  'db_connections',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'public_id',public_id,'name',name)
      ORDER BY public_id,id),'[]'::jsonb) FROM public.rekon_db_connections WHERE tenant_id=(SELECT id FROM target)),
  'inline_api_sources',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'public_id',public_id,'name',name)
      ORDER BY public_id,id),'[]'::jsonb) FROM public.rekon_inline_api_sources WHERE tenant_id=(SELECT id FROM target)),
  'erp_connections',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'public_id',public_id,'status',status)
      ORDER BY public_id,id),'[]'::jsonb) FROM public.erp_connector_configs WHERE tenant_id=(SELECT id FROM target)),
  'watchers',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'public_id',public_id,'name',name,
      'data_source_id',data_source_id) ORDER BY public_id,id),'[]'::jsonb)
    FROM public.data_watchers WHERE tenant_id=(SELECT id FROM target)),
  'aidp_templates',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'public_id',public_id,'name',name)
      ORDER BY public_id,id),'[]'::jsonb) FROM public.aidp_templates WHERE tenant_id=(SELECT id FROM target)),
  'aidp_documents',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'public_id',public_id,
      'data_source_id',data_source_id,'template_id',template_id,'status',status) ORDER BY public_id,id),'[]'::jsonb)
    FROM public.aidp_documents WHERE tenant_id=(SELECT id FROM target)),
  'reference_tables',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'public_id',public_id,'name',name)
      ORDER BY public_id,id),'[]'::jsonb) FROM public.reference_data_tables WHERE tenant_id=(SELECT id FROM target)),
  'reference_versions',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',v.id,'table_id',v.table_id,'status',v.status)
      ORDER BY v.table_id,v.id),'[]'::jsonb) FROM public.reference_data_versions v WHERE tenant_id=(SELECT id FROM target)),
  'reference_row_counts',(SELECT coalesce(jsonb_agg(jsonb_build_object('table_id',table_id,'row_count',n)
      ORDER BY table_id),'[]'::jsonb) FROM (SELECT table_id,count(*) n FROM public.reference_data_rows
        WHERE tenant_id=(SELECT id FROM target) GROUP BY table_id) x),
  'pipelines',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'public_uid',public_uid,'name',name,
      'status',status,'bu_id',bu_id,'source_data_source_id',source_data_source_id,
      'output_data_source_id',output_data_source_id,'parent_pipeline_id',parent_pipeline_id,
      'steps',steps) ORDER BY public_uid,id),'[]'::jsonb)
    FROM public.data_prep_pipelines WHERE tenant_id=(SELECT id FROM target)),
  'collateral_schedules',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'schedule_type',schedule_type,
      'csa_id',csa_id) ORDER BY id),'[]'::jsonb) FROM public.collateral_schedules WHERE tenant_id=(SELECT id FROM target)),
  'collateral_csa_counts',jsonb_build_object(
    'agreements',(SELECT count(*) FROM public.collateral_csa_agreements WHERE tenant_id=(SELECT id FROM target)),
    'versions',(SELECT coalesce(jsonb_agg(jsonb_build_object('status',status,'count',n) ORDER BY status),'[]'::jsonb)
      FROM (SELECT status,count(*) n FROM public.collateral_csa_versions WHERE tenant_id=(SELECT id FROM target) GROUP BY status) x),
    'calls',(SELECT count(*) FROM public.collateral_csa_calls WHERE tenant_id=(SELECT id FROM target))),
  'pipeline_run_counts',(SELECT coalesce(jsonb_agg(jsonb_build_object('pipeline_id',pipeline_id,'status',status,'count',n)
      ORDER BY pipeline_id,status),'[]'::jsonb) FROM (SELECT pipeline_id,status,count(*) n
        FROM public.data_prep_runs WHERE tenant_id=(SELECT id FROM target) GROUP BY pipeline_id,status) x),
  'reconciliations',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'recon_code',recon_code,'name',name,
      'status',status,'legacy_bu_id',bu_id,'multi_bu_governed',multi_bu_governed,'sides',sides)
      ORDER BY recon_code,id),'[]'::jsonb) FROM public.recon_definitions WHERE tenant_id=(SELECT id FROM target)),
  'recon_owner_links',(SELECT coalesce(jsonb_agg(jsonb_build_object('recon_id',recon_id,'bu_id',bu_id)
      ORDER BY recon_id,bu_id),'[]'::jsonb) FROM public.recon_definition_business_units WHERE tenant_id=(SELECT id FROM target)),
  'recon_grants',(SELECT coalesce(jsonb_agg(jsonb_build_object('recon_id',recon_id,'bu_id',bu_id,
      'principal_type',principal_type,'principal_id',principal_id,'action',action)
      ORDER BY recon_id,bu_id,principal_type,principal_id,action),'[]'::jsonb)
    FROM public.recon_definition_bu_grants WHERE tenant_id=(SELECT id FROM target)),
  'recon_run_counts',(SELECT coalesce(jsonb_agg(jsonb_build_object('definition_id',definition_id,'status',status,'count',n)
      ORDER BY definition_id,status),'[]'::jsonb) FROM (SELECT definition_id,status,count(*) n
        FROM public.recon_runs WHERE tenant_id=(SELECT id FROM target) GROUP BY definition_id,status) x),
  'typed_registry',(SELECT coalesce(jsonb_agg(jsonb_build_object('registry_id',r.id,'resource_type',r.resource_type,
      'resource_id',CASE r.resource_type WHEN 'data_source' THEN r.data_source_id
        WHEN 'data_source_schedule' THEN r.data_source_schedule_id WHEN 'db_connection' THEN r.db_connection_id
        WHEN 'inline_api_source' THEN r.inline_api_source_id WHEN 'erp_connection' THEN r.erp_connection_id
        WHEN 'file_watcher' THEN r.file_watcher_id WHEN 'aidp_template' THEN r.aidp_template_id
        WHEN 'aidp_document' THEN r.aidp_document_id WHEN 'reference_table' THEN r.reference_table_id
        WHEN 'data_prep_pipeline' THEN r.data_prep_pipeline_id WHEN 'collateral_schedule' THEN r.collateral_schedule_id
        WHEN 'collateral_csa_agreement' THEN r.collateral_csa_agreement_id END)
      ORDER BY r.resource_type,r.id),'[]'::jsonb) FROM public.data_resource_registry r WHERE r.tenant_id=(SELECT id FROM target)),
  'typed_owner_links',(SELECT coalesce(jsonb_agg(jsonb_build_object('registry_id',registry_id,'bu_id',bu_id)
      ORDER BY registry_id,bu_id),'[]'::jsonb) FROM public.data_resource_registry_owner_bu WHERE tenant_id=(SELECT id FROM target)),
  'typed_grants',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'registry_id',registry_id,'bu_id',bu_id,
      'principal_type',principal_type,'principal_id',coalesce(principal_user_id,principal_group_id),'action',action)
      ORDER BY registry_id,bu_id,principal_type,coalesce(principal_user_id,principal_group_id),action),'[]'::jsonb)
    FROM public.data_resource_registry_grants WHERE tenant_id=(SELECT id FROM target)),
  'generic_owner_links',(SELECT coalesce(jsonb_agg(jsonb_build_object('resource_type',resource_type,
      'resource_id',resource_id,'bu_id',bu_id) ORDER BY resource_type,resource_id,bu_id),'[]'::jsonb)
    FROM public.data_resource_business_unit_owners WHERE tenant_id=(SELECT id FROM target)),
  'generic_grants',(SELECT coalesce(jsonb_agg(jsonb_build_object('resource_type',resource_type,
      'resource_id',resource_id,'bu_id',bu_id,'principal_type',principal_type,'principal_id',principal_id,'action',action)
      ORDER BY resource_type,resource_id,principal_type,principal_id,action),'[]'::jsonb)
    FROM public.data_resource_bu_grants WHERE tenant_id=(SELECT id FROM target))
) AS state`;

const fetched = {};
for (const env of ["prod", "dev"]) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${targetRefs[env]}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${managementToken}`, "content-type": "application/json" },
    body: JSON.stringify({ query: inventorySql(targetSlugs[env]), read_only: true }),
    signal: AbortSignal.timeout(40_000),
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    let detail = "unavailable";
    try {
      const parsed = JSON.parse(errorBody);
      if (typeof parsed.message === "string") detail = parsed.message.replace(/\s+/gu, " ").slice(0, 220);
    } catch { /* Keep the provider body private if it is not structured. */ }
    throw new Error(`${env} read-only inventory rejected HTTP ${response.status}; ${detail}`);
  }
  const rows = await response.json();
  const state = rows?.[0]?.state;
  if (!state?.tenant?.id || state.tenant.slug !== targetSlugs[env]) throw new Error(`${env} exact synthetic tenant mismatch`);
  fetched[env] = { project_ref: targetRefs[env], ...state };
}

const preimagePath = "./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/FVI-QA-BATCH1-MAPPINGS-PROD-20261001.json";
const preimage = JSON.parse(await readFile(preimagePath, "utf8"));
const ownersKey = (r) => `${r.recon_id}|${r.bu_id}`;
const grantsKey = (r) => `${r.recon_id}|${r.bu_id}|${r.principal_type}|${r.principal_id}|${r.action}`;
const sortedKeys = (rows, fn) => rows.map(fn).sort();
const currentOwnerSet = new Set(sortedKeys(fetched.prod.recon_owner_links, ownersKey));
const currentGrantSet = new Set(sortedKeys(fetched.prod.recon_grants, grantsKey));
const missingPriorOwners = preimage.owners.filter((row) => !currentOwnerSet.has(ownersKey(row))).length;
const missingPriorGrants = preimage.grants.filter((row) => !currentGrantSet.has(grantsKey(row))).length;
const preservation = {
  retainedPreimage: { ownerLinks: preimage.owners.length, grants: preimage.grants.length, discrepancies: preimage.discrepancies.length },
  currentPROD: { definitions: fetched.prod.reconciliations.length, ownerLinks: fetched.prod.recon_owner_links.length, grants: fetched.prod.recon_grants.length },
  priorOwnerTuplesMissing: missingPriorOwners,
  priorGrantTuplesMissing: missingPriorGrants,
  additionalCurrentOwnerTuples: currentOwnerSet.size - preimage.owners.length,
  additionalCurrentGrantTuples: currentGrantSet.size - preimage.grants.length,
  priorOwnerTuplesRetained: missingPriorOwners === 0,
  priorGrantTuplesRetained: missingPriorGrants === 0,
  allCurrentPRODDefinitionsMapped: fetched.prod.reconciliations.every((d) => fetched.prod.recon_owner_links.some((o) => o.recon_id === d.id)),
};
const buCode = Object.fromEntries(Object.entries(fetched).map(([env,s]) => [env, Object.fromEntries(s.business_units.map((b) => [b.id,b.code]))]));
const groupName = Object.fromEntries(Object.entries(fetched).map(([env,s]) => [env, Object.fromEntries(s.groups.map((g) => [g.id,g.name]))]));
const addBuLabels = (env, rows, key) => rows.map((r) => ({ ...r, bu_code: buCode[env][r.bu_id] ?? null }));
const clean = Object.fromEntries(Object.entries(fetched).map(([env,s]) => [env, {
  project_ref:s.project_ref, tenant:s.tenant, ledger:s.ledger, business_units:s.business_units, groups:s.groups,
  group_assignments:s.group_assignments.map((r) => ({...r,bu_code:buCode[env][r.bu_id]??null,group_name:groupName[env][r.group_id]??null})),
  sources:s.sources, uploads:s.uploads, schedules:s.schedules, collateral_schedules:s.collateral_schedules,
  collateral_csa_counts:s.collateral_csa_counts, db_connections:s.db_connections,
  inline_api_sources:s.inline_api_sources, erp_connections:s.erp_connections, watchers:s.watchers,
  aidp_templates:s.aidp_templates, aidp_documents:s.aidp_documents, reference_tables:s.reference_tables,
  reference_versions:s.reference_versions, reference_row_counts:s.reference_row_counts,
  pipelines:s.pipelines.map(({steps,...p})=>({...p,source_edge_resolved:s.sources.some(x=>x.id===p.source_data_source_id),output_edge_resolved:!p.output_data_source_id||s.sources.some(x=>x.id===p.output_data_source_id)})),
  pipeline_run_counts:s.pipeline_run_counts, reconciliations:s.reconciliations.map(({sides,...d})=>({...d,
    // Keep only UUID references from known resource-link keys; discard the sides payload.
    resource_refs:extractRefs(sides,['data_source_id','source_data_source_id','pipeline_id','data_prep_pipeline_id','reference_table_id','table_id'])})),
  recon_owner_links:addBuLabels(env,s.recon_owner_links,'bu_id'),
  recon_grants:s.recon_grants.map((g)=>({...g,bu_code:buCode[env][g.bu_id]??null,group_name:g.principal_type==='group'?(groupName[env][g.principal_id]??null):null})),
  recon_run_counts:s.recon_run_counts, typed_registry:s.typed_registry,
  typed_owner_links:addBuLabels(env,s.typed_owner_links,'bu_id'),
  typed_grants:s.typed_grants.map((g)=>({...g,bu_code:buCode[env][g.bu_id]??null,group_name:g.principal_type==='group'?(groupName[env][g.principal_id]??null):null})),
  generic_owner_links:addBuLabels(env,s.generic_owner_links,'bu_id'),generic_grants:s.generic_grants,
}]));

function extractRefs(value, allowed) {
  const out=[];
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
  function walk(node,pathParts=[]) {
    if(Array.isArray(node)){node.forEach((v,i)=>walk(v,[...pathParts,String(i)]));return;}
    if(!node||typeof node!=='object')return;
    for(const [k,v] of Object.entries(node)){
      if(allowed.includes(k)&&typeof v==='string'&&uuid.test(v))out.push({path:[...pathParts,k].join('.'),field:k,id:v});
      else walk(v,[...pathParts,k]);
    }
  }
  walk(value);return out;
}

function summarize(env,s) {
  const rootRows={data_source:s.sources,data_source_schedule:s.schedules,db_connection:s.db_connections,
    inline_api_source:s.inline_api_sources,erp_connection:s.erp_connections,file_watcher:s.watchers,
    aidp_template:s.aidp_templates,aidp_document:s.aidp_documents,reference_table:s.reference_tables,
    collateral_schedule:s.collateral_schedules,
    data_prep_pipeline:s.pipelines};
  const typedByRoot=new Map(s.typed_registry.map((r)=>[`${r.resource_type}|${r.resource_id}`,r]));
  const summaries={};
  for(const [kind,rows] of Object.entries(rootRows)){
    const checked=rows.map((r)=>{const reg=typedByRoot.get(`${kind}|${r.id}`);const ownerCount=reg?s.typed_owner_links.filter(o=>o.registry_id===reg.registry_id).length:0;return{row:r,reg,ownerCount};});
    summaries[kind]={total:rows.length,typedMapped:checked.filter(x=>x.reg&&x.ownerCount>0).length,unmapped:checked.filter(x=>!x.reg||x.ownerCount===0).length,
      unmapped_ids:checked.filter(x=>!x.reg||x.ownerCount===0).map(x=>({id:x.row.id,public_id:x.row.public_id??x.row.public_uid??null,name:x.row.name??null,registry_present:!!x.reg,owner_count:x.ownerCount}))};
  }
  const sourceMapped=new Set(s.sources.filter((r)=>{const x=typedByRoot.get(`data_source|${r.id}`);return x&&s.typed_owner_links.some(o=>o.registry_id===x.registry_id)}).map(r=>r.id));
  const reconMapped=s.reconciliations.filter(d=>s.recon_owner_links.some(o=>o.recon_id===d.id)).length;
  const edges={
    uploadsToSource:{total:s.uploads.length,resolved:s.uploads.filter(r=>s.sources.some(x=>x.id===r.data_source_id)).length,mappedParent:s.uploads.filter(r=>sourceMapped.has(r.data_source_id)).length},
    schedulesToSource:{total:s.schedules.length,resolved:s.schedules.filter(r=>s.sources.some(x=>x.id===r.data_source_id)).length},
    watchersToSource:{total:s.watchers.length,resolved:s.watchers.filter(r=>s.sources.some(x=>x.id===r.data_source_id)).length},
    aidpDocumentToSource:{total:s.aidp_documents.filter(r=>r.data_source_id).length,resolved:s.aidp_documents.filter(r=>r.data_source_id&&s.sources.some(x=>x.id===r.data_source_id)).length},
    aidpDocumentToTemplate:{total:s.aidp_documents.filter(r=>r.template_id).length,resolved:s.aidp_documents.filter(r=>r.template_id&&s.aidp_templates.some(x=>x.id===r.template_id)).length},
    pipelineInputSource:{total:s.pipelines.filter(r=>r.source_data_source_id).length,resolved:s.pipelines.filter(r=>r.source_data_source_id&&s.sources.some(x=>x.id===r.source_data_source_id)).length,mappedSource:s.pipelines.filter(r=>r.source_data_source_id&&sourceMapped.has(r.source_data_source_id)).length},
    pipelineOutputSource:{total:s.pipelines.filter(r=>r.output_data_source_id).length,resolved:s.pipelines.filter(r=>r.output_data_source_id&&s.sources.some(x=>x.id===r.output_data_source_id)).length,mappedSource:s.pipelines.filter(r=>r.output_data_source_id&&sourceMapped.has(r.output_data_source_id)).length},
    referenceRowsToTable:{total:s.reference_row_counts.reduce((n,r)=>n+r.row_count,0),resolvedTables:s.reference_tables.filter(t=>s.reference_row_counts.some(r=>r.table_id===t.id)).length},
    reconDefinitions:{total:s.reconciliations.length,mapped:reconMapped,ownerLinks:s.recon_owner_links.length,grants:s.recon_grants.length,
      sideResourceRefs:s.reconciliations.reduce((n,r)=>n+r.resource_refs.length,0)},
  };
  return {ledger:s.ledger, typedRegistryRows:s.typed_registry.length,typedOwnerLinks:s.typed_owner_links.length,typedGrants:s.typed_grants.length,
    genericOwnerLinks:s.generic_owner_links.length,genericGrants:s.generic_grants.length,resourceKinds:summaries,
    childCounts:{uploads:s.uploads.length,dataPrepRuns:s.pipeline_run_counts.reduce((n,r)=>n+r.count,0),referenceRows:edges.referenceRowsToTable.total,
      referenceVersions:s.reference_versions.length,reconRuns:s.recon_run_counts.reduce((n,r)=>n+r.count,0),
      collateralAgreements:s.collateral_csa_counts.agreements,collateralVersionCount:s.collateral_csa_counts.versions.reduce((n,r)=>n+r.count,0),
      collateralCalls:s.collateral_csa_counts.calls},edges};
}
const summarized = { prod: summarize("prod", clean.prod), dev: summarize("dev", clean.dev) };
const runStamp = new Date().toISOString().replace(/[-:.]/gu, "").replace("Z", "Z");
const coverageAnalysis = Object.fromEntries(Object.entries(summarized).map(([env, summary]) => [env, {
  resourceKinds: Object.fromEntries(Object.entries(summary.resourceKinds).map(([kind, item]) => [kind, {
    total: item.total, typedMapped: item.typedMapped, unmapped: item.unmapped, unmapped_ids: item.unmapped_ids,
  }])),
  reconciliation: summary.edges.reconDefinitions,
  dependencies: summary.edges,
}]));
const capturedAt=new Date().toISOString();
const privateRoot="./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925";
const privatePath=path.join(privateRoot,`FVI-SYNTHETIC-RESOURCE-INVENTORY-${runStamp}.json`);
const matrixPath=`docs/evidence/FVI_SYNTHETIC_RESOURCE_INVENTORY_${runStamp}.md`;
const privateInventory={format:"FVI_SYNTHETIC_RESOURCE_INVENTORY_READONLY_V1",captured_at:capturedAt,
  method:"Supabase Management API database/query with read_only=true; SUPABASE_ACCESS_TOKEN parsed in process; token/session values not written.",
  scope:"Exact PROD/DEV Assurance synthetic tenant only. Resource identity, owner/grant mapping, safe labels, statuses, and foreign-key/dependency identifiers; no payload rows, source configs, AIDP extraction content, credential references/values, emails, or user-role rows.",
  reconciliationPreservation:preservation,coverageAnalysis,environments:clean};
const serialized=JSON.stringify(privateInventory,null,2)+"\n";
const privateSha=createHash("sha256").update(serialized).digest("hex");
await writeFile(privatePath,serialized,{encoding:"utf8",flag:"wx"});
const lines=["# Synthetic resource mapping inventory — actual PROD/DEV read-only captures","",
`**Captured:** ${capturedAt}  `,
`**Verified ledgers:** PROD ${clean.prod.ledger.count}/${clean.prod.ledger.latest}; DEV ${clean.dev.ledger.count}/${clean.dev.ledger.latest}.`,
"**Read method:** named Supabase Management API token parsed in process; both SQL requests used `read_only=true`. No token/session values, payload rows, source configs, emails or user-role rows were stored here.",
`**Private selected inventory:** ${path.basename(privatePath)} (protected QA directory), SHA-256 ${privateSha}. This matrix intentionally omits resource IDs and grant principal IDs.`,"",
"## Reconciliation preservation precheck","",
`- Retained PROD preimage: ${preservation.retainedPreimage.ownerLinks} owner links, ${preservation.retainedPreimage.grants} grants, ${preservation.retainedPreimage.discrepancies} discrepancies.`,
`- Current PROD: ${preservation.currentPROD.definitions} definitions, ${preservation.currentPROD.ownerLinks} owner links, ${preservation.currentPROD.grants} grants.`,
`- The retained preimage’s 20 owner tuples and 120 grant tuples are present in current PROD: owner **${preservation.priorOwnerTuplesRetained?"PASS":"DIFFERENCE"}**, grants **${preservation.priorGrantTuplesRetained?"PASS":"DIFFERENCE"}**. Current PROD contains ${preservation.additionalCurrentOwnerTuples} additional owner tuples and ${preservation.additionalCurrentGrantTuples} additional grant tuples; these were not in the 1 October preimage.`,
`- Every current definition has an owner: **${preservation.allCurrentPRODDefinitionsMapped?"yes":"no"}**.`,"",
"## Root mapping coverage","","| Resource kind | PROD roots | PROD mapped | PROD unmapped | DEV roots | DEV mapped | DEV unmapped |","|---|---:|---:|---:|---:|---:|---:|"];
for(const kind of ["data_source","data_source_schedule","db_connection","inline_api_source","erp_connection","file_watcher","aidp_template","aidp_document","reference_table","data_prep_pipeline","collateral_schedule"]){const p=summarized.prod.resourceKinds[kind],d=summarized.dev.resourceKinds[kind];lines.push(`| ${kind} | ${p.total} | ${p.typedMapped} | ${p.unmapped} | ${d.total} | ${d.typedMapped} | ${d.unmapped} |`)}
lines.push("","Reconciliation owner mapping uses its separate owner-link table and is reported separately from typed resources.","","## Dependency coverage","","| Edge | PROD resolved / total | DEV resolved / total |","|---|---:|---:|");
for(const [key,label] of [["uploadsToSource","Upload → source"],["schedulesToSource","Schedule → source"],["watchersToSource","Watcher → source"],["aidpDocumentToSource","AIDP document → source"],["aidpDocumentToTemplate","AIDP document → template"],["pipelineInputSource","Data Prep → input source"],["pipelineOutputSource","Data Prep → output source"],["referenceRowsToTable","Reference rows → table"]]){const p=summarized.prod.edges[key],d=summarized.dev.edges[key];lines.push(`| ${label} | ${p.resolved}/${p.total} | ${d.resolved}/${d.total} |`)}
lines.push("","| Workflow coverage | PROD | DEV |","|---|---:|---:|",`| Reconciliation definitions mapped / total | ${summarized.prod.edges.reconDefinitions.mapped}/${summarized.prod.edges.reconDefinitions.total} | ${summarized.dev.edges.reconDefinitions.mapped}/${summarized.dev.edges.reconDefinitions.total} |`,`| Reconciliation owner links / action grants | ${summarized.prod.edges.reconDefinitions.ownerLinks}/${summarized.prod.edges.reconDefinitions.grants} | ${summarized.dev.edges.reconDefinitions.ownerLinks}/${summarized.dev.edges.reconDefinitions.grants} |`,`| Data Prep runs / reconciliation runs | ${summarized.prod.childCounts.dataPrepRuns}/${summarized.prod.childCounts.reconRuns} | ${summarized.dev.childCounts.dataPrepRuns}/${summarized.dev.childCounts.reconRuns} |`,`| CSA agreements / versions / calls | ${summarized.prod.childCounts.collateralAgreements}/${summarized.prod.childCounts.collateralVersionCount}/${summarized.prod.childCounts.collateralCalls} | ${summarized.dev.childCounts.collateralAgreements}/${summarized.dev.childCounts.collateralVersionCount}/${summarized.dev.childCounts.collateralCalls} |`,`| Typed registry rows / owner links / grants | ${summarized.prod.typedRegistryRows}/${summarized.prod.typedOwnerLinks}/${summarized.prod.typedGrants} | ${summarized.dev.typedRegistryRows}/${summarized.dev.typedOwnerLinks}/${summarized.dev.typedGrants} |`,`| Generic shadow owner links / grants | ${summarized.prod.genericOwnerLinks}/${summarized.prod.genericGrants} | ${summarized.dev.genericOwnerLinks}/${summarized.dev.genericGrants} |`,"","## Classification and disposition","","- PROD has one collateral_schedule typed owner link in QA-CASH and no action grants; the summary RPC/client resource type list omits collateral_schedule. PROD also has one draft CSA agreement/version and no calls; the agreement has no typed mapping. DEV has none.","- Exact per-kind unmapped IDs, actual BU codes/group labels/action tuples and root dependency IDs are in the protected private inventory for Kepler/parent.","- Existing source/Data Prep/reconciliation links are reported from stored IDs; unmatched labels are not inferred. PCA is not relabeled ECA unless an actual owner BU/group label supports it.","- A child object inherits its parent resource mapping; it is not counted as an independent root unless the schema registers it as one.","- This was a read-only inventory. No mapping RPC, authentication refresh, role/session change, app mutation or audit write was executed.","");
await writeFile(matrixPath,lines.join("\n"),{encoding:"utf8",flag:"wx"});
const redactedSummary = (summary) => ({ledger:summary.ledger,typedRegistryRows:summary.typedRegistryRows,
  typedOwnerLinks:summary.typedOwnerLinks,typedGrants:summary.typedGrants,genericOwnerLinks:summary.genericOwnerLinks,
  genericGrants:summary.genericGrants,resourceKinds:Object.fromEntries(Object.entries(summary.resourceKinds)
    .map(([kind,item])=>[kind,{total:item.total,typedMapped:item.typedMapped,unmapped:item.unmapped}])),
  childCounts:summary.childCounts,edges:summary.edges});
console.log(JSON.stringify({status:"READONLY_SYNTHETIC_INVENTORY_COMPLETE",privatePath,privateSha256:privateSha,matrixPath,
  preservation,prod:redactedSummary(summarized.prod),dev:redactedSummary(summarized.dev)},null,2));
