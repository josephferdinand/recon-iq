import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRef = process.env.FVI_EXPECTED_SUPABASE_REF ?? "";
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const accessTokenFile = path.resolve(process.env.FVI_SUPABASE_PAT_FILE ?? "");
const evidencePath = path.resolve(process.env.FVI_RECON_ASSURANCE_EVIDENCE_PATH ?? "");
const targets = new Map([
  ["YOUR_PROJECT_REF", "reconiq-assurance-lab-prod"],
  ["YOUR_PROJECT_REF", "fvi-validation-lab-20260904"],
]);

if (targets.get(projectRef) !== tenantSlug)
  throw new Error("Project and Assurance tenant do not match");
if (!evidencePath.endsWith(".json")) throw new Error("Evidence path must be a JSON file");
const accessToken = (await readFile(accessTokenFile, "utf8")).trim();
if (!/^sbp_[A-Za-z0-9_-]{20,}$/u.test(accessToken))
  throw new Error("Protected Supabase PAT is unavailable");

const sql = `
with target as (select id from public.tenants where slug='${tenantSlug}'),
assurance_definitions as (
  select id,name from public.recon_definitions
  where tenant_id=(select id from target) and name like 'Assurance S%'
),
assurance_runs as (
  select r.* from public.recon_runs r join assurance_definitions d on d.id=r.definition_id
  where r.tenant_id=(select id from target)
),
latest_runs as (
  select distinct on (definition_id) definition_id,id,matched_count,exception_count,total_rows,status
  from assurance_runs order by definition_id,started_at desc
)
select
  (select count(*)::int from public.workspace_data_sources where tenant_id=(select id from target) and name like 'Assurance S%') as input_sources,
  (select count(*)::int from public.workspace_data_source_uploads u join public.workspace_data_sources s on s.id=u.data_source_id where u.tenant_id=(select id from target) and s.name like 'Assurance S%') as input_uploads,
  (select coalesce(sum(u.row_count),0)::int from public.workspace_data_source_uploads u join public.workspace_data_sources s on s.id=u.data_source_id where u.tenant_id=(select id from target) and s.name like 'Assurance S%') as uploaded_rows,
  (select count(*)::int from public.data_prep_pipelines where tenant_id=(select id from target) and name like 'Assurance DP%') as data_prep_pipelines,
  (select count(*)::int from public.data_prep_runs r join public.data_prep_pipelines p on p.id=r.pipeline_id where r.tenant_id=(select id from target) and p.name like 'Assurance DP%' and r.status='success') as successful_data_prep_runs,
  (select count(*)::int from assurance_definitions) as definitions,
  (select count(*)::int from public.recon_schedules s join assurance_definitions d on d.id=s.definition_id where s.tenant_id=(select id from target)) as schedules,
  (select count(*)::int from assurance_runs where status in ('completed','succeeded')) as completed_runs,
  (select coalesce(sum(matched_count),0)::int from assurance_runs) as matched_groups_all_runs,
  (select coalesce(sum(exception_count),0)::int from assurance_runs) as exceptions_all_runs,
  (select count(*)::int from public.recon_matches m join assurance_runs r on r.id=m.run_id where m.tenant_id=(select id from target)) as retained_match_groups,
  (select count(*)::int from public.recon_exceptions e join assurance_runs r on r.id=e.run_id where e.tenant_id=(select id from target)) as retained_exceptions,
  (select matched_count::int from latest_runs lr join assurance_definitions d on d.id=lr.definition_id where d.name='Assurance S9 — Entity A vs Entity B vs Treasury intercompany') as s9_matches,
  (select exception_count::int from latest_runs lr join assurance_definitions d on d.id=lr.definition_id where d.name='Assurance S9 — Entity A vs Entity B vs Treasury intercompany') as s9_exceptions,
  (select matched_count::int from latest_runs lr join assurance_definitions d on d.id=lr.definition_id where d.name='Assurance S9R — Intercompany after learned sign normalization') as s9r_matches,
  (select exception_count::int from latest_runs lr join assurance_definitions d on d.id=lr.definition_id where d.name='Assurance S9R — Intercompany after learned sign normalization') as s9r_exceptions,
  (select count(*)::int from public.break_comments where tenant_id=(select id from target)) as break_comments,
  (select count(*)::int from public.break_notes where tenant_id=(select id from target)) as break_notes,
  (select count(*)::int from public.audit_log where tenant_id=(select id from target) and occurred_at >= now()-interval '24 hours') as audit_events_24h;
`;

const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
  body: JSON.stringify({ query: sql, read_only: true }),
});
if (!response.ok) {
  const detail = (await response.text()).slice(0, 500);
  throw new Error(`Supabase Management API query failed with HTTP ${response.status}: ${detail}`);
}
const row = (await response.json())[0];
const required = {
  input_sources: 23,
  input_uploads: 23,
  data_prep_pipelines: 10,
  successful_data_prep_runs: 10,
  definitions: 11,
  schedules: 11,
  s9_matches: 2,
  s9_exceptions: 5,
  s9r_matches: 3,
  s9r_exceptions: 4,
};
const checks = Object.entries(required).map(([name, expected]) => ({
  name,
  expected,
  actual: Number(row?.[name] ?? -1),
  passed: Number(row?.[name] ?? -1) >= expected,
}));
const evidence = {
  project_ref: projectRef,
  tenant_slug: tenantSlug,
  captured_at: new Date().toISOString(),
  retained: true,
  state: row,
  checks,
  passed: checks.every((check) => check.passed),
};
await mkdir(path.dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: evidence.passed, tenant_slug: tenantSlug, ...row }));
if (!evidence.passed) process.exitCode = 1;
