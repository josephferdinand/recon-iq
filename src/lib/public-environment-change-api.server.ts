import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { getRuntimeEnv } from "@/lib/runtime-env.server";
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

const PROD_REF = "YOUR_PROJECT_REF" as const;
const DEV_REF = "YOUR_PROJECT_REF" as const;
const uuid = z.string().uuid();
const createBody = z.object({
  direction: z.enum(["dev_to_prod", "prod_to_dev"]),
  source_tenant_id: uuid,
  target_tenant_id: uuid,
  title: z.string().trim().min(3).max(120),
  reason: z.string().trim().min(10).max(1000),
}).strict();
const decisionBody = z.object({
  approve: z.boolean(),
  comment: z.string().trim().max(500).nullable().optional(),
  confirm_access_mapping: z.boolean().optional(),
});

type Authorized = Extract<Awaited<ReturnType<typeof authorizeTenantApiRequest>>, { ok: true }>;

function runtimeProjectRef() {
  return getRuntimeEnv("SUPABASE_PROJECT_ID") ??
    getRuntimeEnv("SUPABASE_URL")?.match(/^https:\/\/([a-z]{20})\.supabase\.co\/?$/u)?.[1];
}

async function parseBody<T extends z.ZodType>(request: Request, schema: T) {
  try {
    return schema.safeParse(await request.json());
  } catch {
    return schema.safeParse(null);
  }
}

function stableFailure(message: string) {
  if (/not found/iu.test(message))
    return { status: 404, body: { error: "environment_change_not_found" } };
  if (/Four-eyes|requires platform|requester cannot|differ from checker/iu.test(message)) {
    return { status: 403, body: { error: "environment_change_forbidden" } };
  }
  if (/not pending|preflight|approved request|already bound|active|stage|review/iu.test(message)) {
    return { status: 409, body: { error: "environment_change_conflict" } };
  }
  if (
    /Manifest|Payload|Invalid|Unsupported|registered ReconIQ|required|must contain|exceeds|release identity/iu.test(
      message,
    )
  ) {
    return { status: 422, body: { error: "environment_change_validation_error" } };
  }
  return { status: 503, body: { error: "environment_change_unavailable" } };
}

function messageOf(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === "string") return value;
  }
  return "";
}

async function claimMutation(request: Request, auth: Authorized, operation: string, body: unknown) {
  const idempotency = requirePublicIdempotencyKey(request, auth.cors);
  if (!idempotency.ok) return idempotency;
  const claim = await claimPublicMutation({
    admin: auth.admin,
    principal: auth.principal,
    operation,
    idempotencyKey: idempotency.key,
    requestBody: body,
    headers: auth.cors,
  });
  if (!claim.ok) return claim;
  return { ok: true as const, key: idempotency.key, requestHash: claim.requestHash };
}

async function completeMutation(args: {
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
    resourceType: "environment_change_request",
    resourceId: args.resourceId,
    context: {
      idempotency_key: args.idempotencyKey,
      ...publicApiRequestContext(args.request),
    },
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

async function recordFailure(
  auth: Authorized,
  operation: string,
  idempotencyKey: string,
  requestHash: string,
  failure: { status: number; body: Record<string, unknown> },
) {
  await completePublicMutation({
    admin: auth.admin,
    principal: auth.principal,
    operation,
    idempotencyKey,
    requestHash,
    responseStatus: failure.status,
    responseBody: failure.body,
  }).catch(() => undefined);
  return workflowApiJson(failure.status, failure.body, auth.cors);
}

export async function listPublicEnvironmentChanges(request: Request, tenantSlug: string) {
  const auth = await authorizeTenantApiRequest({
    request,
    tenantSlug,
    requiredScope: "environment-changes.read",
    methods: "GET",
  });
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.admin
    .from("environment_change_requests")
    .select(
      "id,change_request_uid,direction,source_environment,target_environment,title,status,approval_stage,transport_status,target_change_request_uid,activation_status,access_mapping_preview,access_mapping_confirmed_by,package_hash,configuration_hash,settings_hash,manifest_hash,requested_by,requested_at,decided_by,decided_at,execution_id,executed_by,execution_started_at,execution_completed_at,deployment_outcome,failed_components,final_readback_hash",
    )
    .eq("control_tenant_id", auth.principal.tenantId)
    .order("requested_at", { ascending: false })
    .limit(100);
  if (error)
    return workflowApiJson(503, { error: "environment_change_lookup_unavailable" }, auth.cors);
  await writePublicApiAudit({
    admin: auth.admin,
    principal: auth.principal,
    tenantSlug,
    action: "api.environment_change.list",
    resourceType: "environment_change_request",
    resourceId: null,
    context: { count: data?.length ?? 0, ...publicApiRequestContext(request) },
  });
  return workflowApiJson(200, { data: data ?? [], count: data?.length ?? 0 }, auth.cors);
}

export async function getPublicEnvironmentChange(
  request: Request,
  tenantSlug: string,
  requestId: string,
) {
  const auth = await authorizeTenantApiRequest({
    request,
    tenantSlug,
    requiredScope: "environment-changes.read",
    methods: "GET",
  });
  if (!auth.ok) return auth.response;
  if (!uuid.safeParse(requestId).success) {
    return workflowApiJson(400, { error: "invalid_environment_change_id" }, auth.cors);
  }
  const { data: change, error } = await auth.admin
    .from("environment_change_requests")
    .select("*")
    .eq("control_tenant_id", auth.principal.tenantId)
    .eq("id", requestId)
    .maybeSingle();
  if (error)
    return workflowApiJson(503, { error: "environment_change_lookup_unavailable" }, auth.cors);
  if (!change) return workflowApiJson(404, { error: "environment_change_not_found" }, auth.cors);
  const { data: events, error: eventError } = await auth.admin
    .from("environment_change_events")
    .select("event_sequence,event_type,actor_user_id,context,occurred_at,prev_hash,row_hash")
    .eq("request_id", requestId)
    .order("event_sequence", { ascending: true });
  if (eventError)
    return workflowApiJson(503, { error: "environment_change_lookup_unavailable" }, auth.cors);
  await writePublicApiAudit({
    admin: auth.admin,
    principal: auth.principal,
    tenantSlug,
    action: "api.environment_change.read",
    resourceType: "environment_change_request",
    resourceId: requestId,
    context: publicApiRequestContext(request),
  });
  return workflowApiJson(200, { data: change, events: events ?? [] }, auth.cors);
}

export async function createPublicEnvironmentChange(request: Request, tenantSlug: string) {
  const auth = await authorizeTenantApiRequest({
    request,
    tenantSlug,
    requiredScope: "environment-changes.write",
    methods: "POST",
  });
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(request, createBody);
  if (!parsed.success) {
    return workflowApiJson(
      422,
      { error: "validation_error", details: parsed.error.flatten() },
      auth.cors,
    );
  }
  const sourceEnvironment = parsed.data.direction === "dev_to_prod" ? "dev" : "prod";
  const targetEnvironment = sourceEnvironment === "dev" ? "prod" : "dev";
  const expectedSourceRef = sourceEnvironment === "dev" ? DEV_REF : PROD_REF;
  if (runtimeProjectRef() !== expectedSourceRef) {
    return workflowApiJson(409, { error: "source_environment_required" }, auth.cors);
  }
  if (parsed.data.source_tenant_id !== auth.principal.tenantId) {
    return workflowApiJson(403, { error: "tenant_scope_mismatch" }, auth.cors);
  }
  const { data: environments, error: environmentError } = await auth.admin
    .from("environment_release_registry")
    .select("environment,project_ref,enabled")
    .in("environment", [sourceEnvironment, targetEnvironment]);
  if (environmentError) {
    return workflowApiJson(503, { error: "environment_registry_unavailable" }, auth.cors);
  }
  const source = environments?.find((entry) => entry.environment === sourceEnvironment);
  const target = environments?.find((entry) => entry.environment === targetEnvironment);
  if (!source?.enabled || source.project_ref !== expectedSourceRef ||
      !target?.enabled || target.project_ref !== (targetEnvironment === "dev" ? DEV_REF : PROD_REF)) {
    return workflowApiJson(409, { error: "environment_not_provisioned" }, auth.cors);
  }
  const operation = "environment-change:create";
  const claim = await claimMutation(request, auth, operation, parsed.data);
  if (!claim.ok) return claim.response;
  let manifest: Awaited<ReturnType<typeof import("@/lib/environment-package.server")["buildEnvironmentPackage"]>>;
  try {
    const { buildEnvironmentPackage } = await import("@/lib/environment-package.server");
    manifest = await buildEnvironmentPackage(auth.admin, auth.principal.tenantId);
  } catch (error) {
    return recordFailure(auth, operation, claim.key, claim.requestHash, stableFailure(messageOf(error)));
  }
  const validations = [
    { check: "source_tenant_binding", status: "pass" },
    { check: "secret_free_manifest", status: "pass" },
    { check: "package_inventory", status: "pass", detail: {
      reconciliations: manifest.package.recon_definitions.length,
      data_prep_pipelines: manifest.package.data_prep_pipelines.length,
      data_sources: manifest.configuration.data_sources.length,
      connector_schedules: manifest.configuration.connector_schedules.length,
      watchers: manifest.configuration.watchers.length,
      access_grants: manifest.settings.access_grants.length,
    } },
  ];
  const rpcRequest = {
    control_tenant_id: auth.principal.tenantId,
    ...parsed.data,
    source_environment: sourceEnvironment,
    target_environment: targetEnvironment,
    source_project_ref: source.project_ref,
    target_project_ref: target.project_ref,
    manifest,
    validation_results: validations,
    idempotency_key: claim.key,
  };
  const { data, error } = await auth.admin.rpc("request_source_environment_change_for_api", {
    _request: rpcRequest as unknown as Json,
    _actor_user_id: auth.principal.actorUserId,
  });
  if (error || !data?.[0]) {
    return recordFailure(
      auth,
      operation,
      claim.key,
      claim.requestHash,
      stableFailure(messageOf(error)),
    );
  }
  const responseBody = { data: data[0] };
  return completeMutation({
    auth,
    request,
    tenantSlug,
    operation,
    idempotencyKey: claim.key,
    requestHash: claim.requestHash,
    action: "api.environment_change.create",
    resourceId: data[0].request_id,
    status: 201,
    body: responseBody,
  });
}

export async function decidePublicEnvironmentChange(
  request: Request,
  tenantSlug: string,
  requestId: string,
) {
  const auth = await authorizeTenantApiRequest({
    request,
    tenantSlug,
    requiredScope: "environment-changes.approve",
    methods: "POST",
  });
  if (!auth.ok) return auth.response;
  if (!uuid.safeParse(requestId).success) {
    return workflowApiJson(400, { error: "invalid_environment_change_id" }, auth.cors);
  }
  const parsed = await parseBody(request, decisionBody);
  if (!parsed.success) {
    return workflowApiJson(
      422,
      { error: "validation_error", details: parsed.error.flatten() },
      auth.cors,
    );
  }
  const operation = `environment-change:${requestId}:decision`;
  const { data: change, error: lookupError } = await auth.admin
    .from("environment_change_requests")
    .select("approval_stage,control_tenant_id,source_project_ref,target_project_ref,status")
    .eq("control_tenant_id", auth.principal.tenantId)
    .eq("id", requestId)
    .maybeSingle();
  if (lookupError) return workflowApiJson(503, { error: "environment_change_lookup_unavailable" }, auth.cors);
  if (!change) return workflowApiJson(404, { error: "environment_change_not_found" }, auth.cors);
  const stage = change.approval_stage;
  if (stage !== "source_review" && stage !== "target_review") {
    return workflowApiJson(409, { error: "environment_change_conflict" }, auth.cors);
  }
  const expectedRef = stage === "source_review" ? change.source_project_ref : change.target_project_ref;
  if (runtimeProjectRef() !== expectedRef) {
    return workflowApiJson(409, { error: "review_environment_mismatch" }, auth.cors);
  }
  if (stage === "target_review" && parsed.data.approve && parsed.data.confirm_access_mapping !== true) {
    return workflowApiJson(422, { error: "access_mapping_confirmation_required" }, auth.cors);
  }
  if (stage === "source_review" && parsed.data.approve) {
    const { checkEnvironmentChangeIntake } =
      await import("@/lib/environment-control-plane.server");
    const intake = await checkEnvironmentChangeIntake();
    if (intake !== "open") {
      return workflowApiJson(503, {
        error: intake === "paused"
          ? "environment_change_imports_paused"
          : "environment_change_intake_unavailable",
      }, auth.cors);
    }
  }
  const claim = await claimMutation(request, auth, operation, parsed.data);
  if (!claim.ok) return claim.response;
  const { data, error } = await auth.admin.rpc(stage === "target_review"
    ? "approve_incoming_environment_change_for_api"
    : "decide_source_environment_change_for_api", {
    _request_id: requestId,
    _approve: parsed.data.approve,
    _comment: parsed.data.comment ?? null,
    ...(stage === "target_review" ? { _confirm_access_mapping: parsed.data.confirm_access_mapping === true } : {}),
    _actor_user_id: auth.principal.actorUserId,
  });
  if (error || !data) {
    return recordFailure(
      auth,
      operation,
      claim.key,
      claim.requestHash,
      stableFailure(messageOf(error)),
    );
  }
  const responseBody = { data: { status: data, approval_stage: stage,
    ...(stage === "source_review" && parsed.data.approve ? { transport_status: "pending" } : {}) } };
  return completeMutation({
    auth,
    request,
    tenantSlug,
    operation,
    idempotencyKey: claim.key,
    requestHash: claim.requestHash,
    action: `api.environment_change.${data}`,
    resourceId: requestId,
    status: 200,
    body: responseBody,
  });
}

export const publicEnvironmentChangeCors = workflowApiCors;
