import { readFile } from "node:fs/promises";
import path from "node:path";

const patFile = process.env.FVI_SUPABASE_PAT_FILE ?? "";
if (!path.isAbsolute(patFile)) throw new Error("FVI_SUPABASE_PAT_FILE must be absolute");
const accessToken = (await readFile(patFile, "utf8")).trim();
if (!/^sbp_[A-Za-z0-9_-]{20,}$/u.test(accessToken)) throw new Error("Protected Management API token is unavailable");
const query = `
with target_tenant as (
  select id from public.tenants where slug='reconiq-assurance-lab-prod'
), target_recon as (
  select rd.id, rd.name from public.recon_definitions rd
  where rd.tenant_id=(select id from target_tenant)
    and rd.name='Assurance | PROD | Governed Currency Alias Recon | 2026-09-08'
), latest_run as (
  select rr.id, rr.status, rr.matched_count, rr.exception_count, rr.total_rows, rr.stats
  from public.recon_runs rr where rr.definition_id=(select id from target_recon)
  order by rr.started_at desc limit 1
), target_reference as (
  select rdv.id, rdv.content_sha256, rdv.status, rdv.row_count
  from public.reference_data_versions rdv join public.reference_data_tables rdt on rdt.id=rdv.table_id
  where rdv.tenant_id=(select id from target_tenant)
    and rdt.name='Assurance | PROD | Currency Alias Master | 2026-09-08'
  order by rdv.version_number desc limit 1
)
select jsonb_build_object(
  'recon', (select to_jsonb(target_recon) from target_recon),
  'run', (select jsonb_build_object('id', id, 'status', status, 'matched_count', matched_count,
    'exception_count', exception_count, 'total_rows', total_rows,
    'reference_versions', coalesce(stats->'reference_versions','[]'::jsonb)) from latest_run),
  'reference', (select to_jsonb(target_reference) from target_reference),
  'sources', (select count(*) from public.workspace_data_sources
    where tenant_id=(select id from target_tenant)
      and name in ('Assurance | PROD | Broker Currency Aliases | 2026-09-08','Assurance | PROD | Custodian ISO Currency | 2026-09-08')),
  'uploads', (select count(*) from public.workspace_data_source_uploads u join public.workspace_data_sources s on s.id=u.data_source_id
    where u.tenant_id=(select id from target_tenant)
      and s.name in ('Assurance | PROD | Broker Currency Aliases | 2026-09-08','Assurance | PROD | Custodian ISO Currency | 2026-09-08')),
  'run_audits', (select count(*) from public.audit_log a
    where a.tenant_id=(select id from target_tenant) and a.resource_id=(select id::text from latest_run)
      and a.action='recon.run.complete')
) as state`;
const response = await fetch("https://api.supabase.com/v1/projects/YOUR_PROJECT_REF/database/query", {
  method: "POST",
  headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
  body: JSON.stringify({ query, read_only: true }),
});
if (!response.ok) throw new Error(`Supabase Management API query failed with HTTP ${response.status}`);
const state = (await response.json())[0]?.state;
const references = state?.run?.reference_versions ?? [];
if (!state?.recon || state?.run?.status !== "completed" || state.run.matched_count !== 2
    || state.run.exception_count !== 0 || state.run.total_rows !== 4
    || state.sources !== 2 || state.uploads !== 2 || state.run_audits < 1
    || state.reference?.status !== "published" || state.reference.row_count !== 4
    || references.length !== 1 || references[0].version_id !== state.reference.id
    || references[0].content_sha256 !== state.reference.content_sha256) {
  throw new Error("Managed Reference Data reconciliation live readback failed");
}
console.log(JSON.stringify({ ok: true, project_ref: "YOUR_PROJECT_REF", ...state }));
