import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { DataPrepPipelineSchema } from "@/lib/data-prep.functions";
import { authorizeTenantApiRequest, workflowApiCors, workflowApiJson } from "@/lib/public-workflow-api.server";
import {
  claimPublicMutation,
  completePublicMutation,
  publicApiRequestContext,
  requirePublicIdempotencyKey,
  writePublicApiAudit,
} from "@/lib/public-resource-api.server";

const uuid = z.string().uuid();
const createBody = DataPrepPipelineSchema.omit({ id: true, tenant_id: true });
const updateBody = createBody.partial().refine((value) => Object.keys(value).length > 0, "At least one field is required");
const archiveBody = z.object({ reason: z.string().trim().min(3).max(500) });
const noteBody = z.object({ note: z.string().trim().max(500).optional().nullable() });
const decisionBody = z.object({ approve: z.boolean(), comment: z.string().trim().max(500).optional().nullable() });

type Authorized = Extract<Awaited<ReturnType<typeof authorizeTenantApiRequest>>, { ok: true }>;

async function parseBody<T extends z.ZodType>(request: Request, schema: T) {
  try { return schema.safeParse(await request.json()); }
  catch { return schema.safeParse(null); }
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error
      && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "";
}

export function stableDataPrepFailure(message: string) {
  if (/not found/iu.test(message)) return { status: 404, body: { error: "data_prep_not_found" } };
  if (/Forbidden|Four-eyes|maker cannot|requester cannot/iu.test(message)) {
    return { status: 403, body: { error: "data_prep_forbidden" } };
  }
  if (/pending|already|Only a draft|Only an approved|cannot be edited|before promotion/iu.test(message)) {
    return { status: 409, body: { error: "data_prep_conflict" } };
  }
  if (/required|must contain|exceeds|invalid/iu.test(message)) {
    return { status: 422, body: { error: "data_prep_validation_error" } };
  }
  return { status: 503, body: { error: "data_prep_unavailable" } };
}

async function scopedPipeline(auth: Authorized, pipelineId: string) {
  if (!uuid.safeParse(pipelineId).success) return null;
  const { data, error } = await auth.admin.from("data_prep_pipelines")
    .select("id,public_uid,name,description,source_data_source_id,output_data_source_id,steps,dq_rules,on_failure,enabled,status,version,approved_at,approved_by,lifecycle_state,parent_pipeline_id,promotion_status,promotion_requested_at,promotion_requested_by,promotion_note,promoted_at,promoted_by,last_run_at,last_status,created_by,created_at,updated_at")
    .eq("tenant_id", auth.principal.tenantId).eq("id", pipelineId).maybeSingle();
  if (error) throw new Error("data_prep_lookup_unavailable");
  return data;
}

async function finishMutation(args: {
  auth: Authorized;
  request: Request;
  tenantSlug: string;
  operation: string;
  idempotencyKey: string;
  requestHash: string;
  action: string;
  resourceId: string;
  status: number;
  body: Record<string, unknown>;
}) {
  await writePublicApiAudit({
    admin: args.auth.admin,
    principal: args.auth.principal,
    tenantSlug: args.tenantSlug,
    action: args.action,
    resourceType: "data_prep_pipeline",
    resourceId: args.resourceId,
    context: { idempotency_key: args.idempotencyKey, ...publicApiRequestContext(args.request) },
  });
  await completePublicMutation({
    admin: args.auth.admin,
    principal: args.auth.principal,
    operation: args.operation,
    idempotencyKey: args.idempotencyKey,
    requestHash: args.requestHash,
    responseStatus: args.status,
    responseBody: args.body,
  });
  return workflowApiJson(args.status, args.body, args.auth.cors);
}

async function mutationFailure(
  auth: Authorized,
  operation: string,
  idempotencyKey: string,
  requestHash: string,
  failure: { status: number; body: Record<string, unknown> },
) {
  await completePublicMutation({
    admin: auth.admin, principal: auth.principal, operation,
    idempotencyKey, requestHash, responseStatus: failure.status, responseBody: failure.body,
  }).catch(() => undefined);
  return workflowApiJson(failure.status, failure.body, auth.cors);
}

export async function listPublicDataPrepPipelines(request: Request, tenantSlug: string) {
  const auth = await authorizeTenantApiRequest({ request, tenantSlug, requiredScope: "data-prep.read", methods: "GET" });
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
  let query = auth.admin.from("data_prep_pipelines")
    .select("id,public_uid,name,description,status,version,enabled,lifecycle_state,parent_pipeline_id,promotion_status,last_run_at,last_status,created_at,updated_at")
    .eq("tenant_id", auth.principal.tenantId).order("updated_at", { ascending: false }).limit(limit);
  const lifecycle = url.searchParams.get("lifecycle");
  if (lifecycle) query = query.eq("lifecycle_state", lifecycle);
  const { data, error } = await query;
  if (error) return workflowApiJson(503, { error: "data_prep_lookup_unavailable" }, auth.cors);
  try {
    await writePublicApiAudit({ admin: auth.admin, principal: auth.principal, tenantSlug,
      action: "api.data_prep.list", resourceType: "data_prep_pipeline", resourceId: null,
      context: { count: data?.length ?? 0, ...publicApiRequestContext(request) } });
  } catch { return workflowApiJson(503, { error: "data_prep_audit_unavailable" }, auth.cors); }
  return workflowApiJson(200, { data: data ?? [], count: data?.length ?? 0 }, auth.cors);
}

export async function getPublicDataPrepPipeline(request: Request, tenantSlug: string, pipelineId: string) {
  const auth = await authorizeTenantApiRequest({ request, tenantSlug, requiredScope: "data-prep.read", methods: "GET" });
  if (!auth.ok) return auth.response;
  let pipeline;
  try { pipeline = await scopedPipeline(auth, pipelineId); }
  catch { return workflowApiJson(503, { error: "data_prep_lookup_unavailable" }, auth.cors); }
  if (!pipeline) return workflowApiJson(404, { error: "data_prep_not_found" }, auth.cors);
  try {
    await writePublicApiAudit({ admin: auth.admin, principal: auth.principal, tenantSlug,
      action: "api.data_prep.read", resourceType: "data_prep_pipeline", resourceId: pipelineId,
      context: publicApiRequestContext(request) });
  } catch { return workflowApiJson(503, { error: "data_prep_audit_unavailable" }, auth.cors); }
  return workflowApiJson(200, { data: pipeline }, auth.cors);
}

async function claimMutation(request: Request, auth: Authorized, operation: string, body: unknown) {
  const idempotency = requirePublicIdempotencyKey(request, auth.cors);
  if (!idempotency.ok) return idempotency;
  const claim = await claimPublicMutation({ admin: auth.admin, principal: auth.principal, operation,
    idempotencyKey: idempotency.key, requestBody: body, headers: auth.cors });
  if (!claim.ok) return claim;
  return { ok: true as const, key: idempotency.key, requestHash: claim.requestHash };
}

export async function createPublicDataPrepPipeline(request: Request, tenantSlug: string) {
  const auth = await authorizeTenantApiRequest({ request, tenantSlug, requiredScope: "data-prep.write", methods: "POST" });
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(request, createBody);
  if (!parsed.success) return workflowApiJson(422, { error: "validation_error", details: parsed.error.flatten() }, auth.cors);
  const operation = "data-prep:create";
  const claim = await claimMutation(request, auth, operation, parsed.data);
  if (!claim.ok) return claim.response;
  const { data, error } = await auth.admin.rpc("upsert_data_prep_pipeline_for_api", {
    _tenant_id: auth.principal.tenantId,
    _pipeline_id: null,
    _payload: parsed.data as unknown as Json,
    _actor_user_id: auth.principal.actorUserId,
  });
  if (error || !data?.[0]) return mutationFailure(auth, operation, claim.key, claim.requestHash, stableDataPrepFailure(errorMessage(error)));
  const body = { data: data[0] };
  return finishMutation({ auth, request, tenantSlug, operation, idempotencyKey: claim.key,
    requestHash: claim.requestHash, action: "api.data_prep.create", resourceId: data[0].pipeline_id,
    status: 201, body });
}

export async function updatePublicDataPrepPipeline(request: Request, tenantSlug: string, pipelineId: string) {
  const auth = await authorizeTenantApiRequest({ request, tenantSlug, requiredScope: "data-prep.write", methods: "PATCH" });
  if (!auth.ok) return auth.response;
  if (!uuid.safeParse(pipelineId).success) return workflowApiJson(400, { error: "invalid_pipeline_id" }, auth.cors);
  const parsed = await parseBody(request, updateBody);
  if (!parsed.success) return workflowApiJson(422, { error: "validation_error", details: parsed.error.flatten() }, auth.cors);
  const operation = `data-prep:${pipelineId}:update`;
  const claim = await claimMutation(request, auth, operation, parsed.data);
  if (!claim.ok) return claim.response;
  const { data, error } = await auth.admin.rpc("upsert_data_prep_pipeline_for_api", {
    _tenant_id: auth.principal.tenantId, _pipeline_id: pipelineId,
    _payload: parsed.data as unknown as Json, _actor_user_id: auth.principal.actorUserId,
  });
  if (error || !data?.[0]) return mutationFailure(auth, operation, claim.key, claim.requestHash, stableDataPrepFailure(errorMessage(error)));
  const body = { data: data[0] };
  return finishMutation({ auth, request, tenantSlug, operation, idempotencyKey: claim.key,
    requestHash: claim.requestHash, action: "api.data_prep.update", resourceId: pipelineId, status: 200, body });
}

async function lifecycleMutation<T extends z.ZodType>(args: {
  request: Request; tenantSlug: string; pipelineId: string; requiredScope: string;
  operation: string; action: string; bodySchema: T; method?: string;
  execute: (auth: Authorized, body: z.infer<T>) => Promise<{ body: Record<string, unknown>; status?: number }>;
}) {
  const auth = await authorizeTenantApiRequest({ request: args.request, tenantSlug: args.tenantSlug,
    requiredScope: args.requiredScope, methods: args.method ?? "POST" });
  if (!auth.ok) return auth.response;
  if (!uuid.safeParse(args.pipelineId).success) return workflowApiJson(400, { error: "invalid_pipeline_id" }, auth.cors);
  const parsed = await parseBody(args.request, args.bodySchema);
  if (!parsed.success) return workflowApiJson(422, { error: "validation_error", details: parsed.error.flatten() }, auth.cors);
  const claim = await claimMutation(args.request, auth, args.operation, parsed.data);
  if (!claim.ok) return claim.response;
  try {
    const result = await args.execute(auth, parsed.data);
    return finishMutation({ auth, request: args.request, tenantSlug: args.tenantSlug,
      operation: args.operation, idempotencyKey: claim.key, requestHash: claim.requestHash,
      action: args.action, resourceId: args.pipelineId, status: result.status ?? 200, body: result.body });
  } catch (error) {
    return mutationFailure(auth, args.operation, claim.key, claim.requestHash, stableDataPrepFailure(errorMessage(error)));
  }
}

export const approvePublicDataPrepPipeline = (request: Request, tenantSlug: string, pipelineId: string) =>
  lifecycleMutation({ request, tenantSlug, pipelineId, requiredScope: "data-prep.approve",
    operation: `data-prep:${pipelineId}:approve`, action: "api.data_prep.approve", bodySchema: z.object({}),
    execute: async (auth) => {
      const { data, error } = await auth.admin.rpc("approve_data_prep_pipeline_for_api", {
        _tenant_id: auth.principal.tenantId, _pipeline_id: pipelineId, _actor_user_id: auth.principal.actorUserId,
      });
      if (error || !data?.[0]) throw error ?? new Error("Pipeline approval failed");
      return { body: { data: data[0] } };
    } });

export const clonePublicDataPrepStaging = (request: Request, tenantSlug: string, pipelineId: string) =>
  lifecycleMutation({ request, tenantSlug, pipelineId, requiredScope: "data-prep.write",
    operation: `data-prep:${pipelineId}:staging`, action: "api.data_prep.clone_staging", bodySchema: z.object({}),
    execute: async (auth) => {
      const { data, error } = await auth.admin.rpc("clone_data_prep_staging_for_api", {
        _tenant_id: auth.principal.tenantId, _pipeline_id: pipelineId, _actor_user_id: auth.principal.actorUserId,
      });
      if (error || !data?.[0]) throw error ?? new Error("Staging clone failed");
      return { status: 201, body: { data: data[0] } };
    } });

export const requestPublicDataPrepPromotion = (request: Request, tenantSlug: string, pipelineId: string) =>
  lifecycleMutation({ request, tenantSlug, pipelineId, requiredScope: "data-prep.promote",
    operation: `data-prep:${pipelineId}:promotion-request`, action: "api.data_prep.request_promotion", bodySchema: noteBody,
    execute: async (auth, body) => {
      const { data, error } = await auth.admin.rpc("request_data_prep_promotion_for_api", {
        _tenant_id: auth.principal.tenantId, _staging_id: pipelineId,
        _note: body.note ?? null, _actor_user_id: auth.principal.actorUserId,
      });
      if (error || data !== "pending") throw error ?? new Error("Promotion request failed");
      return { body: { data: { status: data } } };
    } });

export const decidePublicDataPrepPromotion = (request: Request, tenantSlug: string, pipelineId: string) =>
  lifecycleMutation({ request, tenantSlug, pipelineId, requiredScope: "data-prep.approve",
    operation: `data-prep:${pipelineId}:promotion-decision`, action: "api.data_prep.decide_promotion", bodySchema: decisionBody,
    execute: async (auth, body) => {
      const { data, error } = await auth.admin.rpc("decide_data_prep_promotion_for_api", {
        _tenant_id: auth.principal.tenantId, _staging_id: pipelineId, _approve: body.approve,
        _comment: body.comment ?? null, _actor_user_id: auth.principal.actorUserId,
      });
      if (error || !data?.[0]) throw error ?? new Error("Promotion decision failed");
      return { body: { data: data[0] } };
    } });

export const archivePublicDataPrepPipeline = (request: Request, tenantSlug: string, pipelineId: string) =>
  lifecycleMutation({ request, tenantSlug, pipelineId, requiredScope: "data-prep.write",
    operation: `data-prep:${pipelineId}:archive`, action: "api.data_prep.archive", bodySchema: archiveBody, method: "DELETE",
    execute: async (auth, body) => {
      const { data, error } = await auth.admin.rpc("archive_data_prep_pipeline_for_api", {
        _tenant_id: auth.principal.tenantId, _pipeline_id: pipelineId,
        _reason: body.reason, _actor_user_id: auth.principal.actorUserId,
      });
      if (error || data !== "archived") throw error ?? new Error("Pipeline archival failed");
      return { body: { data: { status: data } } };
    } });

export const publicDataPrepCors = workflowApiCors;
