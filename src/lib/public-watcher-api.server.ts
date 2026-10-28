import { z } from "zod";

import {
  authorizeTenantApiRequest,
  workflowApiCors,
  workflowApiJson,
} from "@/lib/public-workflow-api.server";
import {
  claimPublicMutation,
  completePublicMutation,
  publicApiDeterministicUuid,
  publicApiRequestContext,
  requirePublicIdempotencyKey,
  writePublicApiAudit,
} from "@/lib/public-resource-api.server";
import { parseWatcherConfig, WATCHER_TYPES } from "@/lib/watcher-engine";

const uuid = z.string().uuid();
const watcherBody = z
  .object({
    data_source_id: uuid,
    name: z.string().min(2).max(120),
    watch_type: z.enum(WATCHER_TYPES),
    config: z.record(z.string(), z.unknown()).default({}),
    severity: z.enum(["info", "warning", "critical"]).default("warning"),
    enabled: z.boolean().default(true),
  })
  .superRefine((value, context) => {
    try {
      parseWatcherConfig(value.watch_type, value.config);
    } catch (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["config"],
        message: error instanceof Error ? error.message : "Invalid watcher configuration",
      });
    }
  });

async function parseBody(request: Request) {
  try {
    return watcherBody.safeParse(await request.json());
  } catch {
    return watcherBody.safeParse(null);
  }
}

export async function listPublicWatchers(request: Request, tenantSlug: string) {
  const auth = await authorizeTenantApiRequest({
    request,
    tenantSlug,
    requiredScope: "watchers.read",
    methods: "GET",
  });
  if (!auth.ok) return auth.response;
  const limit = Math.min(
    200,
    Math.max(1, Number(new URL(request.url).searchParams.get("limit") ?? 50) || 50),
  );
  const { data, error } = await auth.admin
    .from("data_watchers")
    .select(
      "id,data_source_id,name,watch_type,config,severity,enabled,last_checked_at,last_state,last_alerted_at,created_at,updated_at,data_source:workspace_data_sources(name,status)",
    )
    .eq("tenant_id", auth.principal.tenantId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) return workflowApiJson(503, { error: "watcher_lookup_unavailable" }, auth.cors);
  try {
    await writePublicApiAudit({
      admin: auth.admin,
      principal: auth.principal,
      tenantSlug,
      action: "api.watcher.list",
      resourceType: "data_watcher",
      resourceId: null,
      context: { count: data?.length ?? 0, ...publicApiRequestContext(request) },
    });
  } catch {
    return workflowApiJson(503, { error: "watcher_audit_unavailable" }, auth.cors);
  }
  return workflowApiJson(200, { data: data ?? [], count: data?.length ?? 0 }, auth.cors);
}

export async function createPublicWatcher(request: Request, tenantSlug: string) {
  const auth = await authorizeTenantApiRequest({
    request,
    tenantSlug,
    requiredScope: "watchers.write",
    methods: "POST",
  });
  if (!auth.ok) return auth.response;
  const idempotency = requirePublicIdempotencyKey(request, auth.cors);
  if (!idempotency.ok) return idempotency.response;
  const parsed = await parseBody(request);
  if (!parsed.success)
    return workflowApiJson(
      422,
      { error: "validation_error", details: parsed.error.flatten() },
      auth.cors,
    );
  const operation = "watcher:create";
  const claim = await claimPublicMutation({
    admin: auth.admin,
    principal: auth.principal,
    operation,
    idempotencyKey: idempotency.key,
    requestBody: parsed.data,
    headers: auth.cors,
  });
  if (!claim.ok) return claim.response;
  const id = publicApiDeterministicUuid(
    auth.principal.tokenId,
    operation,
    idempotency.key,
    claim.requestHash,
  );
  let responseBody: Record<string, unknown>;
  try {
    const { data: source } = await auth.admin
      .from("workspace_data_sources")
      .select("id")
      .eq("id", parsed.data.data_source_id)
      .eq("tenant_id", auth.principal.tenantId)
      .maybeSingle();
    if (!source) throw new Error("source_not_found");
    const { data, error } = await auth.admin
      .from("data_watchers")
      .upsert(
        {
          id,
          tenant_id: auth.principal.tenantId,
          created_by: auth.principal.actorUserId,
          ...parsed.data,
        },
        { onConflict: "id" },
      )
      .select("id,name,watch_type,severity,enabled,created_at")
      .single();
    if (error) throw error;
    responseBody = { data };
    await writePublicApiAudit({
      admin: auth.admin,
      principal: auth.principal,
      tenantSlug,
      action: "api.watcher.create",
      resourceType: "data_watcher",
      resourceId: id,
      context: {
        idempotency_key: idempotency.key,
        watch_type: parsed.data.watch_type,
        ...publicApiRequestContext(request),
      },
    });
    await completePublicMutation({
      admin: auth.admin,
      principal: auth.principal,
      operation,
      idempotencyKey: idempotency.key,
      requestHash: claim.requestHash,
      responseStatus: 201,
      responseBody,
    });
  } catch (error) {
    const missing = error instanceof Error && error.message === "source_not_found";
    const failure = { error: missing ? "data_source_not_found" : "watcher_create_unavailable" };
    await completePublicMutation({
      admin: auth.admin,
      principal: auth.principal,
      operation,
      idempotencyKey: idempotency.key,
      requestHash: claim.requestHash,
      responseStatus: missing ? 404 : 503,
      responseBody: failure,
    }).catch(() => undefined);
    return workflowApiJson(missing ? 404 : 503, failure, auth.cors);
  }
  return workflowApiJson(201, responseBody!, auth.cors);
}

type AuthorizedWatcherRequest = Extract<
  Awaited<ReturnType<typeof authorizeTenantApiRequest>>,
  { ok: true }
>;

async function scopedWatcher(
  auth: AuthorizedWatcherRequest,
  watcherId: string,
) {
  if (!uuid.safeParse(watcherId).success) return null;
  const { data, error } = await auth.admin
    .from("data_watchers")
    .select("id")
    .eq("id", watcherId)
    .eq("tenant_id", auth.principal.tenantId)
    .maybeSingle();
  if (error) throw new Error("watcher_lookup_unavailable");
  return data;
}

async function persistWatcherFailure(args: {
  auth: AuthorizedWatcherRequest;
  operation: string;
  idempotencyKey: string;
  requestHash: string;
  error: string;
}) {
  const body = { error: args.error };
  await completePublicMutation({
    admin: args.auth.admin,
    principal: args.auth.principal,
    operation: args.operation,
    idempotencyKey: args.idempotencyKey,
    requestHash: args.requestHash,
    responseStatus: 503,
    responseBody: body,
  }).catch(() => undefined);
  return workflowApiJson(503, body, args.auth.cors);
}

export async function updatePublicWatcher(request: Request, tenantSlug: string, watcherId: string) {
  const auth = await authorizeTenantApiRequest({
    request,
    tenantSlug,
    requiredScope: "watchers.write",
    methods: "PATCH",
  });
  if (!auth.ok) return auth.response;
  const idempotency = requirePublicIdempotencyKey(request, auth.cors);
  if (!idempotency.ok) return idempotency.response;
  const parsed = await parseBody(request);
  if (!parsed.success)
    return workflowApiJson(
      422,
      { error: "validation_error", details: parsed.error.flatten() },
      auth.cors,
    );
  let watcher;
  try {
    watcher = await scopedWatcher(auth, watcherId);
  } catch {
    return workflowApiJson(503, { error: "watcher_lookup_unavailable" }, auth.cors);
  }
  if (!watcher) return workflowApiJson(404, { error: "watcher_not_found" }, auth.cors);
  const { data: source, error: sourceError } = await auth.admin
    .from("workspace_data_sources")
    .select("id")
    .eq("id", parsed.data.data_source_id)
    .eq("tenant_id", auth.principal.tenantId)
    .maybeSingle();
  if (sourceError)
    return workflowApiJson(503, { error: "data_source_lookup_unavailable" }, auth.cors);
  if (!source) return workflowApiJson(404, { error: "data_source_not_found" }, auth.cors);
  const operation = `watcher:${watcherId}:update`;
  const claim = await claimPublicMutation({
    admin: auth.admin,
    principal: auth.principal,
    operation,
    idempotencyKey: idempotency.key,
    requestBody: parsed.data,
    headers: auth.cors,
  });
  if (!claim.ok) return claim.response;
  const { data, error } = await auth.admin
    .from("data_watchers")
    .update(parsed.data)
    .eq("id", watcherId)
    .eq("tenant_id", auth.principal.tenantId)
    .select("id,name,watch_type,severity,enabled,updated_at")
    .single();
  if (error)
    return persistWatcherFailure({
      auth,
      operation,
      idempotencyKey: idempotency.key,
      requestHash: claim.requestHash,
      error: "watcher_update_unavailable",
    });
  const body = { data };
  try {
    await writePublicApiAudit({
      admin: auth.admin,
      principal: auth.principal,
      tenantSlug,
      action: "api.watcher.update",
      resourceType: "data_watcher",
      resourceId: watcherId,
      context: { idempotency_key: idempotency.key, ...publicApiRequestContext(request) },
    });
    await completePublicMutation({
      admin: auth.admin,
      principal: auth.principal,
      operation,
      idempotencyKey: idempotency.key,
      requestHash: claim.requestHash,
      responseStatus: 200,
      responseBody: body,
    });
  } catch {
    return persistWatcherFailure({
      auth,
      operation,
      idempotencyKey: idempotency.key,
      requestHash: claim.requestHash,
      error: "watcher_audit_unavailable",
    });
  }
  return workflowApiJson(200, body, auth.cors);
}

export async function disablePublicWatcher(
  request: Request,
  tenantSlug: string,
  watcherId: string,
) {
  const auth = await authorizeTenantApiRequest({
    request,
    tenantSlug,
    requiredScope: "watchers.write",
    methods: "POST",
  });
  if (!auth.ok) return auth.response;
  const idempotency = requirePublicIdempotencyKey(request, auth.cors);
  if (!idempotency.ok) return idempotency.response;
  let watcher;
  try {
    watcher = await scopedWatcher(auth, watcherId);
  } catch {
    return workflowApiJson(503, { error: "watcher_lookup_unavailable" }, auth.cors);
  }
  if (!watcher) return workflowApiJson(404, { error: "watcher_not_found" }, auth.cors);
  const operation = `watcher:${watcherId}:disable`;
  const claim = await claimPublicMutation({
    admin: auth.admin,
    principal: auth.principal,
    operation,
    idempotencyKey: idempotency.key,
    requestBody: {},
    headers: auth.cors,
  });
  if (!claim.ok) return claim.response;
  const { data, error } = await auth.admin
    .from("data_watchers")
    .update({ enabled: false })
    .eq("id", watcherId)
    .eq("tenant_id", auth.principal.tenantId)
    .select("id,enabled,updated_at")
    .single();
  if (error)
    return persistWatcherFailure({
      auth,
      operation,
      idempotencyKey: idempotency.key,
      requestHash: claim.requestHash,
      error: "watcher_disable_unavailable",
    });
  const body = { data, history_retained: true };
  try {
    await writePublicApiAudit({
      admin: auth.admin,
      principal: auth.principal,
      tenantSlug,
      action: "api.watcher.disable",
      resourceType: "data_watcher",
      resourceId: watcherId,
      context: { idempotency_key: idempotency.key, ...publicApiRequestContext(request) },
    });
    await completePublicMutation({
      admin: auth.admin,
      principal: auth.principal,
      operation,
      idempotencyKey: idempotency.key,
      requestHash: claim.requestHash,
      responseStatus: 200,
      responseBody: body,
    });
  } catch {
    return persistWatcherFailure({
      auth,
      operation,
      idempotencyKey: idempotency.key,
      requestHash: claim.requestHash,
      error: "watcher_audit_unavailable",
    });
  }
  return workflowApiJson(200, body, auth.cors);
}

export async function evaluatePublicWatcher(
  request: Request,
  tenantSlug: string,
  watcherId: string,
) {
  const auth = await authorizeTenantApiRequest({
    request,
    tenantSlug,
    requiredScope: "watchers.write",
    methods: "POST",
  });
  if (!auth.ok) return auth.response;
  const idempotency = requirePublicIdempotencyKey(request, auth.cors);
  if (!idempotency.ok) return idempotency.response;
  let watcher;
  try {
    watcher = await scopedWatcher(auth, watcherId);
  } catch {
    return workflowApiJson(503, { error: "watcher_lookup_unavailable" }, auth.cors);
  }
  if (!watcher) return workflowApiJson(404, { error: "watcher_not_found" }, auth.cors);
  const operation = `watcher:${watcherId}:evaluate`;
  const claim = await claimPublicMutation({
    admin: auth.admin,
    principal: auth.principal,
    operation,
    idempotencyKey: idempotency.key,
    requestBody: {},
    headers: auth.cors,
  });
  if (!claim.ok) return claim.response;
  try {
    const { evaluateWatcherById } = await import("@/lib/watcher-evaluator.server");
    const evaluation = await evaluateWatcherById({
      admin: auth.admin,
      tenantId: auth.principal.tenantId,
      watcherId,
      actorUserId: auth.principal.actorUserId,
      trigger: "api",
    });
    const body = { data: evaluation };
    await completePublicMutation({
      admin: auth.admin,
      principal: auth.principal,
      operation,
      idempotencyKey: idempotency.key,
      requestHash: claim.requestHash,
      responseStatus: 200,
      responseBody: body,
    });
    return workflowApiJson(200, body, auth.cors);
  } catch {
    return persistWatcherFailure({
      auth,
      operation,
      idempotencyKey: idempotency.key,
      requestHash: claim.requestHash,
      error: "watcher_evaluation_unavailable",
    });
  }
}

export async function listPublicWatcherEvents(
  request: Request,
  tenantSlug: string,
  watcherId: string,
) {
  const auth = await authorizeTenantApiRequest({
    request,
    tenantSlug,
    requiredScope: "watchers.read",
    methods: "GET",
  });
  if (!auth.ok) return auth.response;
  let watcher;
  try {
    watcher = await scopedWatcher(auth, watcherId);
  } catch {
    return workflowApiJson(503, { error: "watcher_lookup_unavailable" }, auth.cors);
  }
  if (!watcher) return workflowApiJson(404, { error: "watcher_not_found" }, auth.cors);
  const limit = Math.min(
    200,
    Math.max(1, Number(new URL(request.url).searchParams.get("limit") ?? 50) || 50),
  );
  const { data, error } = await auth.admin
    .from("data_watcher_events")
    .select(
      "id,previous_state,new_state,outcome_code,detail,trigger,actor_user_id,notification_created,occurred_at",
    )
    .eq("tenant_id", auth.principal.tenantId)
    .eq("watcher_id", watcherId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) return workflowApiJson(503, { error: "watcher_event_lookup_unavailable" }, auth.cors);
  try {
    await writePublicApiAudit({
      admin: auth.admin,
      principal: auth.principal,
      tenantSlug,
      action: "api.watcher.events",
      resourceType: "data_watcher",
      resourceId: watcherId,
      context: { count: data?.length ?? 0, ...publicApiRequestContext(request) },
    });
  } catch {
    return workflowApiJson(503, { error: "watcher_audit_unavailable" }, auth.cors);
  }
  return workflowApiJson(200, { data: data ?? [], count: data?.length ?? 0 }, auth.cors);
}

export function publicWatcherCors(request: Request, methods: string) {
  return workflowApiCors(request, methods);
}
