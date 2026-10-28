import { readFile } from "node:fs/promises";
import path from "node:path";

const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Set FVI_VAULT_PATH to the canonical secured vault");
}
const markdown = await readFile(vaultPath, "utf8");
const start = markdown.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
const end = markdown.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
if (start < 0 || end <= start) throw new Error("Canonical credential section unavailable");
const row = markdown.slice(start, end).split(/\r?\n/u)
  .find((line) => line.startsWith("| `SUPABASE_ACCESS_TOKEN` |"));
const token = row?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
if (!token) throw new Error("Management access unavailable");

const query = `
with latest as (
  select distinct on (d.recon_type) r.id, r.total_rows, r.matched_count,
    r.exception_count, d.recon_type
  from public.recon_runs r
  join public.recon_definitions d on d.id = r.definition_id and d.tenant_id = r.tenant_id
  join public.tenants t on t.id = r.tenant_id
  where t.slug = 'reconiq-assurance-lab-prod' and r.status = 'completed'
  order by d.recon_type, r.started_at desc
)
select recon_type, total_rows, matched_count, exception_count,
  (select count(*) from public.recon_matches m where m.run_id = latest.id) as persisted_groups,
  (select coalesce(sum(jsonb_array_length(side_rows)), 0)
    from public.recon_matches m cross join lateral jsonb_each(m.members) as side(side_id, side_rows)
    where m.run_id = latest.id and jsonb_typeof(side_rows) = 'array') as persisted_match_member_rows,
  (select count(*) from public.recon_exceptions e where e.run_id = latest.id) as persisted_exception_rows,
  (select jsonb_object_agg(side_id, records) from (
    select side_id, sum(jsonb_array_length(side_rows)) as records
    from public.recon_matches m cross join lateral jsonb_each(m.members) as side(side_id, side_rows)
    where m.run_id = latest.id and jsonb_typeof(side_rows) = 'array'
    group by side_id
  ) sides) as match_members_by_side
from latest order by recon_type
`;
const response = await fetch("https://api.supabase.com/v1/projects/YOUR_PROJECT_REF/database/query", {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ query, read_only: true }),
  signal: AbortSignal.timeout(20_000),
});
if (!response.ok) {
  const detail = await response.json().catch(() => ({}));
  const code = typeof detail.code === "string" ? detail.code : "unknown";
  throw new Error(`Read-only run-shape inspection failed with HTTP ${response.status} (${code})`);
}
console.log(JSON.stringify({ project: "fvi-prod", tenant: "reconiq-assurance-lab-prod", summaries: await response.json() }));
