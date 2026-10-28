import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runOnce } from "../agents/connector-agent/src/index.ts";

const baseUrl = "https://app.reconiq.example";
const tenantSlug = "reconiq-assurance-lab-prod";
const projectRef = "YOUR_PROJECT_REF";
const agentId = "fvi-assurance-agent-prod-01";
const requestedTypes = new Set((process.env.FVI_CONNECTOR_AGENT_TYPES ?? "local,network_drive,sftp,ftp").split(",").map((value) => value.trim()).filter(Boolean));
for (const type of requestedTypes) {
  if (!["local", "network_drive", "sftp", "ftp"].includes(type)) throw new Error("Invalid connector-agent assurance type");
}
if (process.env.FVI_ALLOW_CONNECTOR_AGENT_LIVE !== "YES")
  throw new Error("Set FVI_ALLOW_CONNECTOR_AGENT_LIVE=YES");

function requiredPath(name, expectedName) {
  const value = process.env[name] ?? "";
  if (!path.isAbsolute(value) || path.basename(value) !== expectedName)
    throw new Error(`${name} must identify ${expectedName}`);
  return value;
}

function markdownToken(markdown) {
  const token = markdown.match(/^- API token: `([^`]+)`$/mu)?.[1] ?? "";
  if (!/^fvi_[A-Za-z0-9_-]{20,}$/u.test(token)) throw new Error("Protected assurance token is unavailable");
  return token;
}

const runToken = markdownToken(await readFile(requiredPath("FVI_CONNECTOR_RUN_TOKEN_FILE", "FVI-Assurance-Lab-Connector-API.md"), "utf8"));
const agentToken = markdownToken(await readFile(requiredPath("FVI_CONNECTOR_AGENT_TOKEN_FILE", "FVI-Assurance-Lab-Connector-Agent-PROD.md"), "utf8"));
const managementToken = (await readFile(requiredPath("FVI_SUPABASE_PAT_FILE", "SUPABASE_PAT"), "utf8")).trim();
if (!/^sbp_[A-Za-z0-9_-]{20,}$/u.test(managementToken)) throw new Error("Management API token is unavailable");

async function managementQuery(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${managementToken}`, "content-type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  if (!response.ok) throw new Error(`Management readback failed with HTTP ${response.status}`);
  return response.json();
}

const schedules = await managementQuery(`
select connector_type, id as schedule_id, data_source_id
from public.data_source_schedules
where tenant_id = (select id from public.tenants where slug = '${tenantSlug}')
  and name in (
    'Assurance Agent Local Folder — PROD', 'Assurance Agent Network Drive — PROD',
    'Assurance Agent SFTP — PROD', 'Assurance Agent FTP — PROD'
  )
order by connector_type
`);
const selectedSchedules = schedules.filter((schedule) => requestedTypes.has(schedule.connector_type));
if (selectedSchedules.length !== requestedTypes.size) throw new Error("Expected one retained schedule for every requested connector-agent type");

const repoRoot = path.resolve(".");
const roots = {
  "fvi-local-assurance": path.join(repoRoot, "test-fixtures", "connectors", "agent", "local"),
  "fvi-network-assurance": "\\\\localhost\\E$\\Aug 2026 Falcon Meta\\ReconIQ - FVI\\test-fixtures\\connectors\\agent\\network",
};

const evidence = [];
for (const schedule of selectedSchedules) {
  const pending = (await managementQuery(`
    select id as job_id, idempotency_key
    from public.workflow_api_jobs
    where tenant_id = (select id from public.tenants where slug = '${tenantSlug}')
      and resource_id = '${schedule.schedule_id}'::uuid
      and job_kind = 'connector_agent_run'
      and status in ('queued','failed','running')
    order by created_at
    limit 1
  `))[0];
  const idempotencyKey = pending?.idempotency_key ?? `agent-${schedule.connector_type}-${Date.now()}`;
  let jobId = pending?.job_id ?? "";
  if (!jobId) {
    const queued = await fetch(`${baseUrl}/api/v1/${tenantSlug}/connectors/${schedule.schedule_id}/runs`, {
      method: "POST",
      headers: { authorization: `Bearer ${runToken}`, "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: "{}",
    });
    const queuedBody = await queued.json();
    if (queued.status !== 202 || !queuedBody.job_id) throw new Error(`${schedule.connector_type} queue failed with HTTP ${queued.status}`);
    jobId = queuedBody.job_id;
  }

  process.env.FVI_AGENT_BASE_URL = baseUrl;
  process.env.FVI_AGENT_TENANT_SLUG = tenantSlug;
  process.env.FVI_AGENT_ID = agentId;
  process.env.FVI_AGENT_API_TOKEN = agentToken;
  process.env.FVI_AGENT_ROOTS_JSON = JSON.stringify(roots);
  process.env.FVI_AGENT_CREDENTIALS_JSON = JSON.stringify({
    "fvi-assurance-sftp": { username: "fvi", password: "testpass" },
    "fvi-assurance-ftp": { username: "fvi", password: "testpass" },
  });
  process.env.FVI_AGENT_RUN_ONCE = "YES";
  process.env.FVI_AGENT_ALLOW_INSECURE_FTP = "YES";
  const executed = await runOnce();
  if (executed.status !== "succeeded" || executed.job_id !== jobId)
    throw new Error(`${schedule.connector_type} agent execution failed`);

  const statusResponse = await fetch(`${baseUrl}/api/v1/${tenantSlug}/workflow-jobs/${jobId}`, {
    headers: { authorization: `Bearer ${runToken}` },
  });
  const status = await statusResponse.json();
  if (!statusResponse.ok || status.status !== "succeeded" || status.result?.rows !== 5)
    throw new Error(`${schedule.connector_type} status readback failed`);

  const readback = (await managementQuery(`
select
  job.status,
  job.job_kind,
  job.attempts,
  (job.result->>'rows')::integer as result_rows,
  upload.row_count as upload_rows,
  upload.content_sha256,
  source.row_count as source_rows,
  source.status as source_status,
  schedule.last_status,
  schedule.last_rows_ingested,
  (select count(*)::integer from public.audit_log audit where audit.resource_id = job.id::text and audit.action = 'connector.agent.lease') as lease_audit,
  (select count(*)::integer from public.audit_log audit where audit.resource_id = job.id::text and audit.action = 'connector.agent.complete') as complete_audit,
  (select count(*)::integer from public.audit_log audit where audit.resource_id = job.id::text and audit.action = 'connector.agent.retry_scheduled') as retry_audit
from public.workflow_api_jobs job
join public.data_source_schedules schedule on schedule.id = job.resource_id
join public.workspace_data_sources source on source.id = schedule.data_source_id
join public.workspace_data_source_uploads upload on upload.id = (job.result->>'upload_id')::uuid
where job.id = '${jobId}'::uuid
  and job.tenant_id = (select id from public.tenants where slug = '${tenantSlug}')
`))[0];
  if (!readback || readback.job_kind !== "connector_agent_run" || readback.result_rows !== 5 || readback.upload_rows !== 5 || readback.source_rows !== 5 || readback.source_status !== "ready" || readback.last_status !== "success" || readback.last_rows_ingested !== 5 || readback.lease_audit < 1 || readback.complete_audit !== 1 || !/^[0-9a-f]{64}$/u.test(readback.content_sha256))
    throw new Error(`${schedule.connector_type} database/audit readback failed`);
  evidence.push({ connector_type: schedule.connector_type, schedule_id: schedule.schedule_id, data_source_id: schedule.data_source_id, job_id: jobId, idempotency_key: idempotencyKey, executed, status, readback });
}

for (const name of ["FVI_AGENT_BASE_URL", "FVI_AGENT_TENANT_SLUG", "FVI_AGENT_ID", "FVI_AGENT_API_TOKEN", "FVI_AGENT_ROOTS_JSON", "FVI_AGENT_CREDENTIALS_JSON", "FVI_AGENT_RUN_ONCE", "FVI_AGENT_ALLOW_INSECURE_FTP"])
  delete process.env[name];

const output = path.resolve(`_e2e_run/connector-agent/prod-${[...requestedTypes].sort().join("-")}.json`);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ ok: true, environment: "prod", tenant_slug: tenantSlug, agent_id: agentId, evidence }, null, 2));
console.log(JSON.stringify({ ok: true, environment: "prod", tests: evidence.map((item) => ({ connector_type: item.connector_type, job_id: item.job_id, rows: item.readback.result_rows, attempts: item.readback.attempts, lease_audit: item.readback.lease_audit, complete_audit: item.readback.complete_audit, retry_audit: item.readback.retry_audit })), evidence_file: output }));
