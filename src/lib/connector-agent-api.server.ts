import { createHash } from "node:crypto";
import { authorizeTenantApiRequest, workflowApiCors, workflowApiJson } from "@/lib/public-workflow-api.server";

const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 50_000;
const MAX_COLUMNS = 500;

export const CONNECTOR_AGENT_TYPES = ["sftp", "ftp", "local", "network_drive"] as const;

function contentLengthTooLarge(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  return Number.isFinite(length) && length > MAX_BODY_BYTES;
}

async function readBoundedJson(request: Request): Promise<unknown> {
  if (contentLengthTooLarge(request)) throw new Error("payload_too_large");
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new Error("payload_too_large");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("invalid_json");
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function validateConnectorAgentId(value: unknown): string | null {
  return typeof value === "string" && AGENT_ID.test(value) ? value : null;
}

export function validateAgentRows(value: unknown) {
  const payload = objectValue(value);
  if (!payload || !Array.isArray(payload.rows) || payload.rows.length > MAX_ROWS) return null;
  if (!Array.isArray(payload.columns) || payload.columns.length > MAX_COLUMNS) return null;
  if (payload.rows.some((row) => !objectValue(row))) return null;
  const columns = payload.columns.map(String);
  if (columns.some((column) => !column || column.length > 200) || new Set(columns).size !== columns.length)
    return null;
  const filename = typeof payload.filename === "string" ? payload.filename.trim() : "";
  if (!filename || filename.length > 255 || /[\\/\0\r\n]/u.test(filename)) return null;
  const serialized = JSON.stringify(payload.rows);
  const sizeBytes = Buffer.byteLength(serialized);
  if (sizeBytes > MAX_BODY_BYTES) return null;
  const computedColumns = [...new Set((payload.rows as Record<string, unknown>[]).flatMap((row) => Object.keys(row)))];
  if (computedColumns.length > MAX_COLUMNS || computedColumns.some((column) => !columns.includes(column)) || columns.some((column) => !computedColumns.includes(column)))
    return null;
  return {
    rows: payload.rows as Record<string, unknown>[],
    columns,
    filename,
    sizeBytes,
    contentSha256: createHash("sha256").update(serialized).digest("hex"),
  };
}

function rpcErrorStatus(message: string) {
  if (/not authorized|scope|tenant/iu.test(message)) return 403;
  if (/not valid|not found/iu.test(message)) return 409;
  if (/invalid|exceeds/iu.test(message)) return 422;
  return 503;
}

export async function leaseConnectorAgentJob(request: Request, tenantSlug: string) {
  const cors = workflowApiCors(request, "POST");
  let payload: Record<string, unknown> | null;
  try {
    payload = objectValue(await readBoundedJson(request));
  } catch (error) {
    const code = error instanceof Error ? error.message : "invalid_json";
    return workflowApiJson(code === "payload_too_large" ? 413 : 400, { error: code }, cors);
  }
  const agentId = validateConnectorAgentId(payload?.agent_id);
  const leaseSeconds = Number(payload?.lease_seconds ?? 120);
  if (!agentId || !Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 300)
    return workflowApiJson(422, { error: "invalid_agent_lease" }, cors);

  const auth = await authorizeTenantApiRequest({
    request,
    tenantSlug,
    requiredScope: "connectors.agent",
    methods: "POST",
    rateLimit: 60,
  });
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.admin.rpc("claim_connector_agent_job", {
    _tenant_id: auth.principal.tenantId,
    _token_id: auth.principal.tokenId,
    _agent_id: agentId,
    _lease_seconds: leaseSeconds,
  });
  if (error) return workflowApiJson(rpcErrorStatus(error.message), { error: "agent_lease_unavailable" }, auth.cors);
  const job = Array.isArray(data) ? data[0] : data;
  if (!job) return new Response(null, { status: 204, headers: auth.cors });
  return workflowApiJson(200, {
    api_version: "v1",
    job_id: job.job_id,
    schedule_id: job.schedule_id,
    connector_type: job.connector_type,
    config: job.config,
    attempt: job.attempt,
    lease_expires_at: job.lease_expires_at,
  }, auth.cors);
}

export async function completeConnectorAgentJob(request: Request, tenantSlug: string, jobId: string) {
  const cors = workflowApiCors(request, "POST");
  if (!UUID.test(jobId)) return workflowApiJson(400, { error: "invalid_job_id" }, cors);
  let payload: Record<string, unknown> | null;
  try {
    payload = objectValue(await readBoundedJson(request));
  } catch (error) {
    const code = error instanceof Error ? error.message : "invalid_json";
    return workflowApiJson(code === "payload_too_large" ? 413 : 400, { error: code }, cors);
  }
  const agentId = validateConnectorAgentId(payload?.agent_id);
  const normalized = validateAgentRows(payload);
  if (!agentId || !normalized)
    return workflowApiJson(422, { error: "invalid_connector_result" }, cors);
  const auth = await authorizeTenantApiRequest({
    request,
    tenantSlug,
    requiredScope: "connectors.agent",
    methods: "POST",
    rateLimit: 30,
  });
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.admin.rpc("complete_connector_agent_job", {
    _tenant_id: auth.principal.tenantId,
    _token_id: auth.principal.tokenId,
    _agent_id: agentId,
    _job_id: jobId,
    _rows: normalized.rows,
    _columns: normalized.columns,
    _filename: normalized.filename,
    _content_sha256: normalized.contentSha256,
    _size_bytes: normalized.sizeBytes,
  });
  if (error) return workflowApiJson(rpcErrorStatus(error.message), { error: "agent_completion_rejected" }, auth.cors);
  const result = Array.isArray(data) ? data[0] : data;
  return workflowApiJson(200, {
    api_version: "v1",
    job_id: jobId,
    status: result?.job_status ?? "succeeded",
    upload_id: result?.upload_id,
    row_count: result?.row_count ?? normalized.rows.length,
  }, auth.cors);
}

export async function failConnectorAgentJob(request: Request, tenantSlug: string, jobId: string) {
  const cors = workflowApiCors(request, "POST");
  if (!UUID.test(jobId)) return workflowApiJson(400, { error: "invalid_job_id" }, cors);
  let payload: Record<string, unknown> | null;
  try {
    payload = objectValue(await readBoundedJson(request));
  } catch (error) {
    const code = error instanceof Error ? error.message : "invalid_json";
    return workflowApiJson(code === "payload_too_large" ? 413 : 400, { error: code }, cors);
  }
  const agentId = validateConnectorAgentId(payload?.agent_id);
  const errorCode = typeof payload?.error_code === "string" ? payload.error_code : "";
  if (!agentId || !/^connector_agent_[a-z0-9_]{1,80}$/u.test(errorCode))
    return workflowApiJson(422, { error: "invalid_agent_failure" }, cors);
  const auth = await authorizeTenantApiRequest({
    request,
    tenantSlug,
    requiredScope: "connectors.agent",
    methods: "POST",
    rateLimit: 30,
  });
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.admin.rpc("fail_connector_agent_job", {
    _tenant_id: auth.principal.tenantId,
    _token_id: auth.principal.tokenId,
    _agent_id: agentId,
    _job_id: jobId,
    _error_code: errorCode,
  });
  if (error) return workflowApiJson(rpcErrorStatus(error.message), { error: "agent_failure_rejected" }, auth.cors);
  const result = Array.isArray(data) ? data[0] : data;
  const retry = Number(result?.retry_after_seconds ?? 0);
  return workflowApiJson(200, {
    api_version: "v1",
    job_id: jobId,
    status: result?.job_status ?? "failed",
    retry_after_seconds: retry,
  }, { ...auth.cors, ...(retry > 0 ? { "retry-after": String(retry) } : {}) });
}
