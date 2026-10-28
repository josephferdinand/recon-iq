import { readFile } from "node:fs/promises";
import path from "node:path";

const projectRef = "YOUR_PROJECT_REF";
const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Set FVI_VAULT_PATH to the canonical secured vault");
}
const vault = await readFile(vaultPath, "utf8");
const start = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
const end = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
if (start < 0 || end <= start) throw new Error("Canonical credential section unavailable");
const tokenLine = vault.slice(start, end).split(/\r?\n/u)
  .find((line) => line.startsWith("| `SUPABASE_ACCESS_TOKEN` |"));
const token = tokenLine?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
if (!token) throw new Error("Management access unavailable");

const query = `
  select s.name, s.cron_expression, s.enabled, s.last_run_at,
    (select count(*) from public.audit_log a
      where a.resource_type = 'recon_schedule' and a.resource_id = s.id::text
        and a.action in ('recon.schedule.create', 'recon.schedule.update')) as change_audits,
    (select jsonb_agg(a.action order by a.occurred_at) from public.audit_log a
      where a.resource_type = 'recon_schedule' and a.resource_id = s.id::text
        and a.action in ('recon.schedule.create', 'recon.schedule.update')) as actions
  from public.recon_schedules s
  join public.tenants t on t.id = s.tenant_id
  where t.slug = 'reconiq-assurance-lab-prod'
    and s.name = 'Assurance QA | Schedule Edit Verified | 2026-09-23'
`;
const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ query, read_only: true }),
  signal: AbortSignal.timeout(20_000),
});
if (!response.ok) {
  const detail = await response.json().catch(() => ({}));
  const code = typeof detail.code === "string" ? detail.code : "unknown";
  const message = typeof detail.message === "string" ? detail.message.slice(0, 180) : "query rejected";
  throw new Error(`Read-only schedule inspection failed with HTTP ${response.status} (${code}: ${message})`);
}
const rows = await response.json();
console.log(JSON.stringify({ project: "fvi-prod", tenant: "reconiq-assurance-lab-prod", rows }));
