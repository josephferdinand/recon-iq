import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import {
  authorizeTenantApiRequest,
  workflowApiCors,
  workflowApiJson,
} from "@/lib/public-workflow-api.server";
import {
  claimPublicMutation,
  completePublicMutation,
  publicApiRequestContext,
  requirePublicIdempotencyKey,
  writePublicApiAudit,
} from "@/lib/public-resource-api.server";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const stageBody = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(10000),
  effective_from: isoDate,
  effective_to: isoDate.optional().nullable(),
  change_note: z.string().trim().min(3).max(1000),
}).superRefine((value, context) => {
  if (value.effective_to && value.effective_to < value.effective_from) {
    context.addIssue({ code: "custom", path: ["effective_to"], message: "Invalid effective date range" });
  }
});
const decisionBody = z.object({
  approve: z.boolean(),
  reason: z.string().trim().max(1000).optional().nullable(),
}).superRefine((value, context) => {
  if (!value.approve && (value.reason?.length ?? 0) < 3) {
    context.addIssue({ code: "custom", path: ["reason"], message: "A rejection reason is required" });
  }
});
const rollbackBody = z.object({
  effective_from: isoDate,
  reason: z.string().trim().min(3).max(1000),
});

type AuthorizedReferenceRequest = Extract<
  Awaited<ReturnType<typeof authorizeTenantApiRequest>>,
  { ok: true }
>;

async function parseBody<T extends z.ZodType>(request: Request, schema: T) {
  try {
    return schema.safeParse(await request.json());
  } catch {
    return schema.safeParse(null);
  }
}

export function stableReferenceFailure(message: string) {
  if (/not found|No published reference version/iu.test(message)) {
    return { status: 404, body: { error: "reference_data_not_found" } };
  }
  if (/Forbidden|Only the version maker|Maker cannot/iu.test(message)) {
    return { status: 403, body: { error: "reference_data_forbidden" } };
  }
  if (/pending|Only a draft|Only a pending|overlap|advance the effective date/iu.test(message)) {
    return { status: 409, body: { error: "reference_data_conflict" } };
  }
  if (/must|required|Invalid|contain between|missing/iu.test(message)) {
    return { status: 422, body: { error: "reference_data_validation_error" } };
  }
  return { status: 503, body: { error: "reference_data_unavailable" } };
}

export function referenceErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error
      && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "";
}

async function scopedTable(auth: AuthorizedReferenceRequest, tableId: string) {
  if (!uuid.safeParse(tableId).success) return null;
  const { data, error } = await auth.admin
    .from("reference_data_tables")
    .select("id,name,key_columns,value_columns,row_count,published_version_id,created_at,updated_at")
    .eq("id", tableId)
    .eq("tenant_id", auth.principal.tenantId)
    .maybeSingle();
  if (error) throw new Error("reference_data_lookup_unavailable");
  return data;
}

async function scopedVersion(
  auth: AuthorizedReferenceRequest,
  tableId: string,
  versionId: string,
) {
  if (!uuid.safeParse(versionId).success) return null;
  const { data, error } = await auth.admin
    .from("reference_data_versions")
    .select("id,table_id,version_number,status,effective_from,effective_to,row_count,content_sha256,change_note,created_by,created_at,submitted_by,submitted_at,decided_by,decided_at,decision_reason,published_at")
    .eq("id", versionId)
    .eq("table_id", tableId)
    .eq("tenant_id", auth.principal.tenantId)
    .maybeSingle();
  if (error) throw new Error("reference_data_lookup_unavailable");
  return data;
}

async function persistMutationResult(args: {
  auth: AuthorizedReferenceRequest;
  tenantSlug: string;
  request: Request;
  operation: string;
  idempotencyKey: string;
  requestHash: string;
  action: string;
  resourceId: string;
  responseStatus: number;
  responseBody: Record<string, unknown>;
  context?: Record<string, unknown>;
}) {
  await writePublicApiAudit({
    admin: args.auth.admin,
    principal: args.auth.principal,
    tenantSlug: args.tenantSlug,
    action: args.action,
    resourceType: "reference_data_version",
    resourceId: args.resourceId,
    context: {
      idempotency_key: args.idempotencyKey,
      ...(args.context ?? {}),
      ...publicApiRequestContext(args.request),
    },
  });
  await completePublicMutation({
    admin: args.auth.admin,
    principal: args.auth.principal,
    operation: args.operation,
    idempotencyKey: args.idempotencyKey,
    requestHash: args.requestHash,
    responseStatus: args.responseStatus,
    responseBody: args.responseBody,
  });
}

async function persistMutationFailure(args: {
  auth: AuthorizedReferenceRequest;
  operation: string;
  idempotencyKey: string;
  requestHash: string;
  status: number;
  body: Record<string, unknown>;
}) {
  await completePublicMutation({
    admin: args.auth.admin,
    principal: args.auth.principal,
    operation: args.operation,
    idempotencyKey: args.idempotencyKey,
    requestHash: args.requestHash,
    responseStatus: args.status,
    responseBody: args.body,
  }).catch(() => undefined);
  return workflowApiJson(args.status, args.body, args.auth.cors);
}

export async function listPublicReferenceTables(request: Request, tenantSlug: string) {
  const auth = await authorizeTenantApiRequest({
    request, tenantSlug, requiredScope: "reference-data.read", methods: "GET",
  });
  if (!auth.ok) return auth.response;
  const limit = Math.min(200, Math.max(1, Number(new URL(request.url).searchParams.get("limit") ?? 50) || 50));
  const { data, error } = await auth.admin
    .from("reference_data_tables")
    .select("id,name,description,key_columns,value_columns,row_count,is_active,published_version_id,created_at,updated_at")
    .eq("tenant_id", auth.principal.tenantId)
    .order("name")
    .limit(limit);
  if (error) return workflowApiJson(503, { error: "reference_data_lookup_unavailable" }, auth.cors);
  try {
    await writePublicApiAudit({
      admin: auth.admin,
      principal: auth.principal,
      tenantSlug,
      action: "api.reference_data.list",
      resourceType: "reference_data_table",
      resourceId: null,
      context: { count: data?.length ?? 0, ...publicApiRequestContext(request) },
    });
  } catch {
    return workflowApiJson(503, { error: "reference_data_audit_unavailable" }, auth.cors);
  }
  return workflowApiJson(200, { data: data ?? [], count: data?.length ?? 0 }, auth.cors);
}

export async function listPublicReferenceVersions(
  request: Request,
  tenantSlug: string,
  tableId: string,
) {
  const auth = await authorizeTenantApiRequest({
    request, tenantSlug, requiredScope: "reference-data.read", methods: "GET",
  });
  if (!auth.ok) return auth.response;
  let table;
  try { table = await scopedTable(auth, tableId); }
  catch { return workflowApiJson(503, { error: "reference_data_lookup_unavailable" }, auth.cors); }
  if (!table) return workflowApiJson(404, { error: "reference_data_not_found" }, auth.cors);
  const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get("limit") ?? 25) || 25));
  const { data, error } = await auth.admin
    .from("reference_data_versions")
    .select("id,version_number,status,effective_from,effective_to,row_count,content_sha256,change_note,created_by,created_at,submitted_by,submitted_at,decided_by,decided_at,decision_reason,published_at")
    .eq("tenant_id", auth.principal.tenantId)
    .eq("table_id", tableId)
    .order("version_number", { ascending: false })
    .limit(limit);
  if (error) return workflowApiJson(503, { error: "reference_data_lookup_unavailable" }, auth.cors);
  try {
    await writePublicApiAudit({
      admin: auth.admin,
      principal: auth.principal,
      tenantSlug,
      action: "api.reference_data.versions",
      resourceType: "reference_data_table",
      resourceId: tableId,
      context: { count: data?.length ?? 0, ...publicApiRequestContext(request) },
    });
  } catch {
    return workflowApiJson(503, { error: "reference_data_audit_unavailable" }, auth.cors);
  }
  return workflowApiJson(200, { table, data: data ?? [], count: data?.length ?? 0 }, auth.cors);
}

export async function stagePublicReferenceVersion(
  request: Request,
  tenantSlug: string,
  tableId: string,
) {
  const auth = await authorizeTenantApiRequest({
    request, tenantSlug, requiredScope: "reference-data.write", methods: "POST",
  });
  if (!auth.ok) return auth.response;
  if (!uuid.safeParse(tableId).success) return workflowApiJson(400, { error: "invalid_table_id" }, auth.cors);
  const idempotency = requirePublicIdempotencyKey(request, auth.cors);
  if (!idempotency.ok) return idempotency.response;
  const parsed = await parseBody(request, stageBody);
  if (!parsed.success) return workflowApiJson(422, { error: "validation_error", details: parsed.error.flatten() }, auth.cors);
  const operation = `reference-data:${tableId}:stage`;
  const claim = await claimPublicMutation({
    admin: auth.admin, principal: auth.principal, operation,
    idempotencyKey: idempotency.key, requestBody: parsed.data, headers: auth.cors,
  });
  if (!claim.ok) return claim.response;
  try {
    const { data, error } = await auth.admin.rpc("stage_reference_data_version_for_api", {
      _tenant_id: auth.principal.tenantId,
      _table_id: tableId,
      _rows: parsed.data.rows as unknown as Json,
      _effective_from: parsed.data.effective_from,
      _effective_to: parsed.data.effective_to ?? null,
      _change_note: parsed.data.change_note,
      _actor_user_id: auth.principal.actorUserId,
    });
    if (error) throw error;
    const version = Array.isArray(data) ? data[0] : data;
    if (!version) throw new Error("Version was not staged");
    const body = { data: version };
    await persistMutationResult({
      auth, tenantSlug, request, operation, idempotencyKey: idempotency.key,
      requestHash: claim.requestHash, action: "api.reference_data.version.stage",
      resourceId: version.version_id, responseStatus: 201, responseBody: body,
      context: { table_id: tableId, version: version.version_number, content_sha256: version.content_sha256 },
    });
    return workflowApiJson(201, body, auth.cors);
  } catch (error) {
    const failure = stableReferenceFailure(referenceErrorMessage(error));
    return persistMutationFailure({ auth, operation, idempotencyKey: idempotency.key, requestHash: claim.requestHash, ...failure });
  }
}

export async function submitPublicReferenceVersion(
  request: Request,
  tenantSlug: string,
  tableId: string,
  versionId: string,
) {
  const auth = await authorizeTenantApiRequest({
    request, tenantSlug, requiredScope: "reference-data.write", methods: "POST",
  });
  if (!auth.ok) return auth.response;
  const idempotency = requirePublicIdempotencyKey(request, auth.cors);
  if (!idempotency.ok) return idempotency.response;
  let version;
  try { version = await scopedVersion(auth, tableId, versionId); }
  catch { return workflowApiJson(503, { error: "reference_data_lookup_unavailable" }, auth.cors); }
  if (!version) return workflowApiJson(404, { error: "reference_data_not_found" }, auth.cors);
  const operation = `reference-data:${tableId}:${versionId}:submit`;
  const claim = await claimPublicMutation({
    admin: auth.admin, principal: auth.principal, operation,
    idempotencyKey: idempotency.key, requestBody: {}, headers: auth.cors,
  });
  if (!claim.ok) return claim.response;
  try {
    const { data: status, error } = await auth.admin.rpc("submit_reference_data_version_for_api", {
      _tenant_id: auth.principal.tenantId,
      _version_id: versionId,
      _actor_user_id: auth.principal.actorUserId,
    });
    if (error) throw error;
    const body = { data: { id: versionId, status } };
    await persistMutationResult({
      auth, tenantSlug, request, operation, idempotencyKey: idempotency.key,
      requestHash: claim.requestHash, action: "api.reference_data.version.submit",
      resourceId: versionId, responseStatus: 200, responseBody: body, context: { table_id: tableId },
    });
    return workflowApiJson(200, body, auth.cors);
  } catch (error) {
    const failure = stableReferenceFailure(referenceErrorMessage(error));
    return persistMutationFailure({ auth, operation, idempotencyKey: idempotency.key, requestHash: claim.requestHash, ...failure });
  }
}

export async function decidePublicReferenceVersion(
  request: Request,
  tenantSlug: string,
  tableId: string,
  versionId: string,
) {
  const auth = await authorizeTenantApiRequest({
    request, tenantSlug, requiredScope: "reference-data.approve", methods: "POST",
  });
  if (!auth.ok) return auth.response;
  const idempotency = requirePublicIdempotencyKey(request, auth.cors);
  if (!idempotency.ok) return idempotency.response;
  const parsed = await parseBody(request, decisionBody);
  if (!parsed.success) return workflowApiJson(422, { error: "validation_error", details: parsed.error.flatten() }, auth.cors);
  let version;
  try { version = await scopedVersion(auth, tableId, versionId); }
  catch { return workflowApiJson(503, { error: "reference_data_lookup_unavailable" }, auth.cors); }
  if (!version) return workflowApiJson(404, { error: "reference_data_not_found" }, auth.cors);
  const operation = `reference-data:${tableId}:${versionId}:decision`;
  const claim = await claimPublicMutation({
    admin: auth.admin, principal: auth.principal, operation,
    idempotencyKey: idempotency.key, requestBody: parsed.data, headers: auth.cors,
  });
  if (!claim.ok) return claim.response;
  try {
    const { data: status, error } = await auth.admin.rpc("decide_reference_data_version_for_api", {
      _tenant_id: auth.principal.tenantId,
      _version_id: versionId,
      _approve: parsed.data.approve,
      _reason: parsed.data.reason ?? null,
      _actor_user_id: auth.principal.actorUserId,
    });
    if (error) throw error;
    const body = { data: { id: versionId, status } };
    await persistMutationResult({
      auth, tenantSlug, request, operation, idempotencyKey: idempotency.key,
      requestHash: claim.requestHash,
      action: parsed.data.approve ? "api.reference_data.version.publish" : "api.reference_data.version.reject",
      resourceId: versionId, responseStatus: 200, responseBody: body,
      context: { table_id: tableId, approve: parsed.data.approve },
    });
    return workflowApiJson(200, body, auth.cors);
  } catch (error) {
    const failure = stableReferenceFailure(referenceErrorMessage(error));
    return persistMutationFailure({ auth, operation, idempotencyKey: idempotency.key, requestHash: claim.requestHash, ...failure });
  }
}

export async function rollbackPublicReferenceVersion(
  request: Request,
  tenantSlug: string,
  tableId: string,
  versionId: string,
) {
  const auth = await authorizeTenantApiRequest({
    request, tenantSlug, requiredScope: "reference-data.write", methods: "POST",
  });
  if (!auth.ok) return auth.response;
  const idempotency = requirePublicIdempotencyKey(request, auth.cors);
  if (!idempotency.ok) return idempotency.response;
  const parsed = await parseBody(request, rollbackBody);
  if (!parsed.success) return workflowApiJson(422, { error: "validation_error", details: parsed.error.flatten() }, auth.cors);
  let version;
  try { version = await scopedVersion(auth, tableId, versionId); }
  catch { return workflowApiJson(503, { error: "reference_data_lookup_unavailable" }, auth.cors); }
  if (!version) return workflowApiJson(404, { error: "reference_data_not_found" }, auth.cors);
  const operation = `reference-data:${tableId}:${versionId}:rollback`;
  const claim = await claimPublicMutation({
    admin: auth.admin, principal: auth.principal, operation,
    idempotencyKey: idempotency.key, requestBody: parsed.data, headers: auth.cors,
  });
  if (!claim.ok) return claim.response;
  try {
    const { data, error } = await auth.admin.rpc("request_reference_data_rollback_for_api", {
      _tenant_id: auth.principal.tenantId,
      _table_id: tableId,
      _source_version_id: versionId,
      _effective_from: parsed.data.effective_from,
      _reason: parsed.data.reason,
      _actor_user_id: auth.principal.actorUserId,
    });
    if (error) throw error;
    const draft = Array.isArray(data) ? data[0] : data;
    if (!draft) throw new Error("Rollback draft was not created");
    const body = { data: draft };
    await persistMutationResult({
      auth, tenantSlug, request, operation, idempotencyKey: idempotency.key,
      requestHash: claim.requestHash, action: "api.reference_data.version.rollback_requested",
      resourceId: draft.version_id, responseStatus: 201, responseBody: body,
      context: { table_id: tableId, source_version_id: versionId, version: draft.version_number },
    });
    return workflowApiJson(201, body, auth.cors);
  } catch (error) {
    const failure = stableReferenceFailure(referenceErrorMessage(error));
    return persistMutationFailure({ auth, operation, idempotencyKey: idempotency.key, requestHash: claim.requestHash, ...failure });
  }
}

export function referenceCsvCell(value: unknown) {
  let text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  if (/^[=+@]/u.test(text) || /^-\D/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function exportPublicReferenceVersion(
  request: Request,
  tenantSlug: string,
  tableId: string,
  versionId: string,
) {
  const auth = await authorizeTenantApiRequest({
    request, tenantSlug, requiredScope: "reference-data.read", methods: "GET",
  });
  if (!auth.ok) return auth.response;
  let table;
  let version;
  try {
    table = await scopedTable(auth, tableId);
    version = await scopedVersion(auth, tableId, versionId);
  } catch {
    return workflowApiJson(503, { error: "reference_data_lookup_unavailable" }, auth.cors);
  }
  if (!table || !version) return workflowApiJson(404, { error: "reference_data_not_found" }, auth.cors);
  const { data: rows, error } = await auth.admin
    .from("reference_data_version_rows")
    .select("row_data,key_hash")
    .eq("tenant_id", auth.principal.tenantId)
    .eq("table_id", tableId)
    .eq("version_id", versionId)
    .order("key_hash")
    .limit(10000);
  if (error) return workflowApiJson(503, { error: "reference_data_export_unavailable" }, auth.cors);
  const format = new URL(request.url).searchParams.get("format")?.toLowerCase() ?? "json";
  if (format !== "json" && format !== "csv") {
    return workflowApiJson(422, { error: "unsupported_export_format" }, auth.cors);
  }
  try {
    await writePublicApiAudit({
      admin: auth.admin,
      principal: auth.principal,
      tenantSlug,
      action: "api.reference_data.version.export",
      resourceType: "reference_data_version",
      resourceId: versionId,
      context: { table_id: tableId, format, rows: rows?.length ?? 0, ...publicApiRequestContext(request) },
    });
  } catch {
    return workflowApiJson(503, { error: "reference_data_audit_unavailable" }, auth.cors);
  }
  const headers = {
    ...auth.cors,
    "x-fvi-reference-version": String(version.version_number),
    "x-fvi-content-sha256": version.content_sha256 ?? "",
  };
  if (format === "json") {
    return workflowApiJson(200, {
      metadata: {
        table_id: tableId,
        table_name: table.name,
        version_id: versionId,
        version_number: version.version_number,
        status: version.status,
        effective_from: version.effective_from,
        effective_to: version.effective_to,
        content_sha256: version.content_sha256,
      },
      data: (rows ?? []).map((row) => row.row_data),
      count: rows?.length ?? 0,
    }, headers);
  }
  const columns = [...table.key_columns, ...table.value_columns];
  const lines = [
    `# table_id,${tableId}`,
    `# version_id,${versionId}`,
    `# version_number,${version.version_number}`,
    `# content_sha256,${version.content_sha256 ?? ""}`,
    columns.map(referenceCsvCell).join(","),
    ...(rows ?? []).map((item) => {
      const row = item.row_data && !Array.isArray(item.row_data) && typeof item.row_data === "object"
        ? item.row_data as Record<string, Json | undefined>
        : {};
      return columns.map((column) => referenceCsvCell(row[column])).join(",");
    }),
  ];
  return new Response(lines.join("\r\n"), {
    status: 200,
    headers: {
      ...headers,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="reference-data-v${version.version_number}.csv"`,
    },
  });
}

export function publicReferenceDataCors(request: Request, methods: string) {
  return workflowApiCors(request, methods);
}
