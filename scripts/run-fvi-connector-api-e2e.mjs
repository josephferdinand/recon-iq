import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

if (process.env.FVI_RUN_CONNECTOR_API_E2E !== "YES") {
  throw new Error("Set FVI_RUN_CONNECTOR_API_E2E=YES for live connector API assurance");
}
const baseUrl = (process.env.FVI_E2E_BASE_URL ?? "").replace(/\/+$/, "");
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const scheduleId = process.env.FVI_CONNECTOR_SCHEDULE_ID ?? "";
const tokenFile = process.env.FVI_CONNECTOR_API_TOKEN_FILE ?? "";
const cronFile = process.env.FVI_CRON_SECRET_FILE ?? "";
if (!/^https:\/\/(?:app|dev\.app|[0-9a-f]+\.fvi-app(?:-staging)?)\.falconveritas\.com$/u.test(baseUrl)
    && !/^https:\/\/[0-9a-f]+\.fvi-app(?:-staging)?\.pages\.dev$/u.test(baseUrl)) {
  throw new Error("FVI_E2E_BASE_URL must be a canonical or exact FVI deployment origin");
}
if (!/^[a-z0-9-]+$/u.test(tenantSlug)) throw new Error("Invalid tenant slug");
if (!/^[0-9a-f-]{36}$/iu.test(scheduleId)) throw new Error("Invalid schedule ID");
if (!path.isAbsolute(tokenFile) || !/^FVI-Assurance-Lab-Connector-API(?:-DEV)?\.md$/u.test(path.basename(tokenFile))) {
  throw new Error("Connector token must use the environment-specific secured-vault file");
}
if (!path.isAbsolute(cronFile) || path.basename(cronFile) !== "SLA_CRON_HMAC") {
  throw new Error("Cron secret must use the protected SLA_CRON_HMAC file");
}
const tokenText = await readFile(tokenFile, "utf8");
const token = tokenText.match(/^- API token: `([^`]+)`$/mu)?.[1] ?? "";
const cronSecret = (await readFile(cronFile, "utf8")).trim();
if (!token || !cronSecret) throw new Error("Protected assurance credential file is empty");

const endpoint = `${baseUrl}/api/v1/${tenantSlug}/connectors/${scheduleId}/runs`;
const idempotencyKey = `connector-e2e-${randomUUID()}`;
const requestHeaders = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
  "idempotency-key": idempotencyKey,
};

const missing = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json", "idempotency-key": `${idempotencyKey}-missing` },
});
if (missing.status !== 401) throw new Error(`Missing bearer expected 401, received ${missing.status}`);

const wrongTenant = await fetch(
  `${baseUrl}/api/v1/${tenantSlug}-wrong/connectors/${scheduleId}/runs`,
  { method: "POST", headers: { ...requestHeaders, "idempotency-key": `${idempotencyKey}-tenant` } },
);
if (wrongTenant.status !== 403) throw new Error(`Wrong tenant expected 403, received ${wrongTenant.status}`);

const queued = await fetch(endpoint, { method: "POST", headers: requestHeaders });
const queuedBody = await queued.json();
if (queued.status !== 202 || !queuedBody.job_id) {
  throw new Error(`Connector enqueue failed with ${queued.status}`);
}

const worker = await fetch(`${baseUrl}/api/public/cron/workflow-jobs`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-cron-secret": cronSecret },
  body: JSON.stringify({ job_id: queuedBody.job_id, max_jobs: 1 }),
});
const workerBody = await worker.json();
if (!worker.ok || workerBody.processed !== 1) throw new Error(`Connector worker failed with ${worker.status}`);

const statusUrl = `${baseUrl}/api/v1/${tenantSlug}/workflow-jobs/${queuedBody.job_id}`;
const terminal = await fetch(statusUrl, { headers: { authorization: `Bearer ${token}` } });
const terminalBody = await terminal.json();
if (!terminal.ok || terminalBody.status !== "succeeded" || terminalBody.job_kind !== "connector_run") {
  throw new Error(`Connector terminal poll failed with ${terminal.status}`);
}
if (!Number.isInteger(terminalBody.result?.rows) || terminalBody.result.rows < 1) {
  throw new Error("Connector terminal result did not contain a positive row count");
}

const replay = await fetch(endpoint, { method: "POST", headers: requestHeaders });
const replayBody = await replay.json();
if (replay.status !== 200 || replayBody.job_id !== queuedBody.job_id || replayBody.idempotent_replay !== true) {
  throw new Error(`Connector idempotent replay failed with ${replay.status}`);
}

console.log(JSON.stringify({
  ok: true,
  base_url: baseUrl,
  tenant_slug: tenantSlug,
  schedule_id: scheduleId,
  job_id: queuedBody.job_id,
  rows: terminalBody.result.rows,
  attempts: terminalBody.attempts,
  missing_bearer_status: missing.status,
  wrong_tenant_status: wrongTenant.status,
  replay_status: replay.status,
  idempotent_replay: true,
}));
