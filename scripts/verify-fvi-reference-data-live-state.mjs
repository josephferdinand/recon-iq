import { readFile } from "node:fs/promises";
import path from "node:path";

const targetName = process.env.FVI_REFERENCE_DATA_TARGET ?? "";
const targets = {
  prod: { ref: "YOUR_PROJECT_REF", tenantSlug: "reconiq-assurance-lab-prod" },
  dev: { ref: "YOUR_PROJECT_REF", tenantSlug: "reconiq-assurance-lab-dev" },
};
const target = targets[targetName];
if (!target) throw new Error("FVI_REFERENCE_DATA_TARGET must be prod or dev");
const patFile = process.env.FVI_SUPABASE_PAT_FILE ?? "";
if (!path.isAbsolute(patFile)) throw new Error("FVI_SUPABASE_PAT_FILE must be absolute");
const accessToken = (await readFile(patFile, "utf8")).trim();
if (!/^sbp_[A-Za-z0-9_-]{20,}$/u.test(accessToken)) throw new Error("Protected Management API token is unavailable");

const query = `
select jsonb_build_object(
  'ledger_count', (select count(*) from supabase_migrations.schema_migrations),
  'table', (
    select jsonb_build_object('id', rdt.id, 'tenant_id', rdt.tenant_id, 'name', rdt.name, 'row_count', rdt.row_count,
      'published_version_id', rdt.published_version_id)
    from public.reference_data_tables rdt join public.tenants t on t.id=rdt.tenant_id
    where t.slug='${target.tenantSlug}' and rdt.name='fx_spot_rates'
  ),
  'versions', coalesce((
    select jsonb_agg(jsonb_build_object('id', rdv.id, 'version_number', rdv.version_number,
      'status', rdv.status, 'row_count', rdv.row_count, 'content_sha256', rdv.content_sha256,
      'effective_from', rdv.effective_from, 'effective_to', rdv.effective_to)
      order by rdv.version_number)
    from public.reference_data_versions rdv
    join public.reference_data_tables rdt on rdt.id=rdv.table_id
    join public.tenants t on t.id=rdv.tenant_id
    where t.slug='${target.tenantSlug}' and rdt.name='fx_spot_rates'
  ), '[]'::jsonb),
  'version_rows', (
    select count(*) from public.reference_data_version_rows r
    join public.reference_data_tables rdt on rdt.id=r.table_id
    join public.tenants t on t.id=r.tenant_id
    where t.slug='${target.tenantSlug}' and rdt.name='fx_spot_rates'
  ),
  'projection_rows', (
    select count(*) from public.reference_data_rows r
    join public.reference_data_tables rdt on rdt.id=r.table_id
    join public.tenants t on t.id=r.tenant_id
    where t.slug='${target.tenantSlug}' and rdt.name='fx_spot_rates'
  ),
  'lifecycle_audits', (
    select count(*) from public.audit_log a join public.tenants t on t.id=a.tenant_id
    where t.slug='${target.tenantSlug}' and a.action like 'reference_data.version.%'
  )
) as state`;
const response = await fetch(`https://api.supabase.com/v1/projects/${target.ref}/database/query`, {
  method: "POST",
  headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
  body: JSON.stringify({ query, read_only: true }),
});
if (!response.ok) throw new Error(`Supabase Management API query failed with HTTP ${response.status}`);
const rows = await response.json();
console.log(JSON.stringify({ ok: true, target: targetName, project_ref: target.ref, ...rows[0]?.state }));
