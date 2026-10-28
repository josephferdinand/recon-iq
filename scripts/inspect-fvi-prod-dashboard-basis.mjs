// Read-only, secret-safe comparison source for the Workspace Dashboard's 30 UTC calendar-day KPIs.
import { readFile } from "node:fs/promises";
import path from "node:path";

const vaultPath = process.env.FVI_VAULT_PATH ?? "";
const dashboardEnvironment = process.env.FVI_DASHBOARD_ENV ?? "prod";
if (dashboardEnvironment !== "prod" && dashboardEnvironment !== "dev") {
  throw new Error("FVI_DASHBOARD_ENV must be prod or dev");
}
const target = dashboardEnvironment === "prod"
  ? { project: "fvi-prod", ref: "YOUR_PROJECT_REF", slug: "reconiq-assurance-lab-prod" }
  : { project: "fvi-dev", ref: "YOUR_PROJECT_REF", slug: "reconiq-assurance-lab-development" };
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
with bounds as (
  select now() as as_of,
    (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC') - interval '29 days' as window_start
), target as (
  select id from public.tenants where slug = '${target.slug}'
), runs as (
  select r.status, r.total_rows, r.matched_count, r.exception_count, r.stats
  from public.recon_runs r join target t on t.id = r.tenant_id
  where r.started_at >= (select window_start from bounds)
), run_summary as (
  select count(*) as runs_30d,
    count(*) filter (where status = 'completed') as completed_runs,
    count(*) filter (where status = 'failed') as failed_runs,
    count(*) filter (where status = 'completed' and jsonb_typeof(stats->'matched_records') = 'number') as completed_with_record_stats,
    coalesce(sum(total_rows) filter (where status = 'completed'), 0) as completed_input_rows,
    coalesce(sum((stats->>'matched_records')::numeric) filter (where status = 'completed' and jsonb_typeof(stats->'matched_records') = 'number'), 0) as matched_input_records,
    coalesce(sum(matched_count) filter (where status = 'completed'), 0) as matched_groups,
    coalesce(sum(exception_count) filter (where status = 'completed'), 0) as exception_items
  from runs
), exception_summary as (
  select count(*) as open_exceptions,
    count(*) filter (where severity = 'critical') as critical,
    count(*) filter (where severity = 'high') as high,
    count(*) filter (where severity = 'medium') as medium,
    count(*) filter (where severity = 'low') as low
  from public.recon_exceptions e join target t on t.id = e.tenant_id
  where e.status = 'open'
), schedule_summary as (
  select count(*) filter (where enabled) as active_schedules
  from public.recon_schedules s join target t on t.id = s.tenant_id
)
select (select as_of from bounds) as as_of, (select window_start from bounds) as window_start,
  run_summary.*, exception_summary.*, schedule_summary.*
from run_summary cross join exception_summary cross join schedule_summary
`;
const response = await fetch(`https://api.supabase.com/v1/projects/${target.ref}/database/query`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ query, read_only: true }),
  signal: AbortSignal.timeout(20_000),
});
if (!response.ok) {
  const detail = await response.json().catch(() => ({}));
  throw new Error(`Read-only dashboard inspection failed with HTTP ${response.status} (${typeof detail.code === "string" ? detail.code : "unknown"})`);
}
console.log(JSON.stringify({ project: target.project, tenant: target.slug, window: "30 UTC calendar days", basis: await response.json() }));
