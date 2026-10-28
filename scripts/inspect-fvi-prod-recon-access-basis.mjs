// Exact FVI PROD, read-only and count-only preflight for multi-BU authorization.
import { readFile } from "node:fs/promises";
import path from "node:path";

const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Set FVI_VAULT_PATH to the canonical secured vault");
}
const markdown = await readFile(vaultPath, "utf8");
const begin = markdown.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
const end = markdown.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
if (begin < 0 || end <= begin) throw new Error("Canonical credential section unavailable");
const row = markdown.slice(begin, end).split(/\r?\n/u)
  .find((line) => line.startsWith("| `SUPABASE_ACCESS_TOKEN` |"));
const token = row?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
if (!token) throw new Error("Management access unavailable");

const query = `
with target as (
  select id from public.tenants where slug='reconiq-assurance-lab-prod'
), summary as (
  select count(*) as definitions,
    count(*) filter (where d.bu_id is null) as without_legacy_bu,
    count(*) filter (where d.bu_id is not null) as with_legacy_bu,
    count(*) filter (where d.status='draft') as draft,
    count(*) filter (where d.status='active') as active,
    count(*) filter (where d.status='archived') as archived,
    count(*) filter (where d.visibility='tenant') as tenant_visible,
    count(*) filter (where d.visibility='restricted') as restricted
  from public.recon_definitions d join target t on t.id=d.tenant_id
)
select summary.*,
 (select count(*) from public.business_units b join target t on t.id=b.tenant_id) as business_units,
 (select count(*) from public.tenant_groups g join target t on t.id=g.tenant_id) as groups,
 (select count(*) from public.recon_permissions p join public.recon_definitions d on d.id=p.recon_id join target t on t.id=d.tenant_id) as recon_grants,
 (select count(*) from public.recon_permissions p join public.recon_definitions d on d.id=p.recon_id join target t on t.id=d.tenant_id where p.principal_type='group' and not exists (select 1 from public.tenant_groups g where g.id=p.principal_id and g.tenant_id=d.tenant_id)) as invalid_group_grants,
 (select count(*) from public.recon_permissions p join public.recon_definitions d on d.id=p.recon_id join target t on t.id=d.tenant_id where p.principal_type='user' and not exists (select 1 from public.tenant_members m where m.user_id=p.principal_id and m.tenant_id=d.tenant_id and m.active)) as inactive_or_foreign_user_grants
from summary
`;
const response = await fetch("https://api.supabase.com/v1/projects/YOUR_PROJECT_REF/database/query", {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ query, read_only: true }),
  signal: AbortSignal.timeout(20_000),
});
if (!response.ok) {
  const detail = await response.json().catch(() => ({}));
  throw new Error(`Read-only access inventory failed with HTTP ${response.status} (${typeof detail.code === "string" ? detail.code : "unknown"})`);
}
console.log(JSON.stringify({ project: "fvi-prod", tenant: "reconiq-assurance-lab-prod", basis: await response.json() }));
