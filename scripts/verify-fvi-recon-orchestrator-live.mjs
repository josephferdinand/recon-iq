import { readFile } from "node:fs/promises";
import path from "node:path";

const targetName = process.env.FVI_RECON_ORCHESTRATOR_TARGET ?? "";
const projectRef = { prod: "YOUR_PROJECT_REF", dev: "YOUR_PROJECT_REF" }[targetName];
if (!projectRef) throw new Error("FVI_RECON_ORCHESTRATOR_TARGET must be prod or dev");
const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Set FVI_VAULT_PATH to the canonical secured vault");
}

function vaultValue(markdown, key) {
  const start = markdown.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
  const end = markdown.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
  const line = markdown.slice(start, end).split(/\r?\n/u)
    .find((candidate) => candidate.startsWith(`| \`${key}\` |`));
  const value = line?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
  if (!value) throw new Error(`Missing vault field ${key}`);
  return value;
}

const token = vaultValue(await readFile(vaultPath, "utf8"), "SUPABASE_ACCESS_TOKEN");
const sql = `select
  (select count(*)::integer from supabase_migrations.schema_migrations) as ledger_count,
  (select count(*)::integer from public.recon_schedules) as schedules,
  (select count(*)::integer from public.recon_schedules where enabled) as enabled_schedules,
  (select count(*)::integer from public.recon_schedule_runs where status='running') as running,
  (select count(*)::integer from public.recon_schedule_runs where started_at >= now()-interval '30 minutes' and occurrence_key like 'cron:%') as cron_runs_30m,
  (select count(*)::integer from public.recon_schedule_runs where started_at >= now()-interval '30 minutes' and trigger='manual') as manual_runs_30m,
  (select count(*)::integer from public.recon_schedule_runs where started_at >= now()-interval '30 minutes' and status='completed') as completed_30m,
  (select count(*)::integer from public.recon_schedule_runs where started_at >= now()-interval '30 minutes' and status='failed') as failed_30m,
  (select count(*)::integer from public.audit_log where occurred_at >= now()-interval '30 minutes' and action in
    ('system.recon.schedule.run.started','system.recon.schedule.run.complete','recon.schedule.run.started','recon.schedule.run.complete')) as run_audits_30m,
  (select max(started_at) from public.recon_schedule_runs) as latest_started_at`;

const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ query: sql, read_only: true }),
});
if (!response.ok) throw new Error(`Supabase Management API readback failed with HTTP ${response.status}`);
const row = (await response.json())[0];
if (row.ledger_count !== 334 || row.running > 1 || row.failed_30m > 0) {
  throw new Error(`Recon Orchestrator live readback failed for ${targetName}`);
}
console.log(JSON.stringify({ ok: true, target: targetName, ...row }));
