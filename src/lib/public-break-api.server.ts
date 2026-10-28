import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  authorizeTenantApiRequest,
  hasWorkflowScope,
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

const uuid = z.string().uuid();
const lifecycle = z.enum([
  "new",
  "assigned",
  "investigating",
  "pending_counterparty",
  "resolved",
  "written_off",
]);
const priority = z.enum(["P1", "P2", "P3", "P4"]);

const breakAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), assignee: uuid.nullable() }),
  z.object({
    action: z.literal("classify"),
    root_cause: z.string().min(1).max(500),
    priority: priority.optional(),
    tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  }),
  z.object({
    action: z.literal("comment"),
    body: z.string().min(1).max(4000),
    internal: z.boolean().default(true),
  }),
  z.object({
    action: z.literal("attach"),
    filename: z.string().min(1).max(255),
    mime_type: z.string().max(100).optional(),
    size_bytes: z.number().int().min(0).max(25_000_000).optional(),
  }),
  z.object({
    action: z.literal("resolve"),
    resolution_note: z.string().min(1).max(4000),
    root_cause: z.string().min(1).max(500).optional(),
  }),
  z.object({
    action: z.literal("write_off"),
    reason: z.string().min(1).max(4000),
    amount: z.number().finite(),
    currency: z.string().regex(/^[A-Z]{3}$/u),
    gl_account: z.string().min(1).max(100),
  }),
  z.object({
    action: z.literal("approve_write_off"),
    request_id: uuid,
    decision: z.enum(["approved", "rejected"]),
    decision_note: z.string().max(2000).optional(),
  }),
  z.object({ action: z.literal("reopen"), reason: z.string().min(1).max(4000) }),
  z.object({ action: z.literal("reprocess") }),
]);

export function parsePublicBreakAction(value: unknown) {
  return breakAction.safeParse(value);
}

export function classifyPublicBreakActionFailure(
  action: z.infer<typeof breakAction>,
  error: unknown,
) {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? String(error.message)
        : String(error ?? "");
  if (
    action.action === "approve_write_off" &&
    /Maker cannot approve or reject their own write-off request/iu.test(message)
  ) {
    return { status: 403, body: { error: "independent_approval_required" } } as const;
  }
  return { status: 503, body: { error: "break_action_unavailable" } } as const;
}

async function scopedRunIds(admin: SupabaseClient, tenantId: string, reconId: string) {
  const { data, error } = await admin
    .from("recon_runs")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("definition_id", reconId)
    .limit(5000);
  if (error) throw new Error("run_lookup_unavailable");
  return (data ?? []).map((row: { id: string }) => row.id);
}

async function getScopedBreak(
  admin: SupabaseClient,
  tenantId: string,
  reconId: string,
  breakId: string,
) {
  const { data, error } = await admin
    .from("recon_exceptions")
    .select("*")
    .eq("id", breakId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error("break_lookup_unavailable");
  if (!data) return null;
  const { data: run, error: runError } = await admin
    .from("recon_runs")
    .select("id,definition_id")
    .eq("id", data.run_id)
    .eq("tenant_id", tenantId)
    .eq("definition_id", reconId)
    .maybeSingle();
  if (runError) throw new Error("run_lookup_unavailable");
  return run ? { ...data, run } : null;
}

export async function listPublicBreaks(request: Request, tenantSlug: string, reconId: string) {
  const auth = await authorizeTenantApiRequest({
    request,
    tenantSlug,
    requiredScope: "recons.read",
    methods: "GET",
  });
  if (!auth.ok) return auth.response;
  if (!uuid.safeParse(reconId).success)
    return workflowApiJson(400, { error: "invalid_recon_id" }, auth.cors);

  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
  const state = url.searchParams.get("state");
  const assignee = url.searchParams.get("assignee");
  if (state && !lifecycle.safeParse(state).success) {
    return workflowApiJson(400, { error: "invalid_state" }, auth.cors);
  }
  if (assignee && !uuid.safeParse(assignee).success) {
    return workflowApiJson(400, { error: "invalid_assignee" }, auth.cors);
  }

  let runIds: string[];
  try {
    runIds = await scopedRunIds(auth.admin, auth.principal.tenantId, reconId);
  } catch {
    return workflowApiJson(503, { error: "break_lookup_unavailable" }, auth.cors);
  }
  if (runIds.length === 0) {
    try {
      await writePublicApiAudit({ admin: auth.admin, principal: auth.principal, tenantSlug, action: "api.break.list", resourceType: "recon_definition", resourceId: reconId, context: { count: 0, ...publicApiRequestContext(request) } });
    } catch { return workflowApiJson(503, { error: "break_audit_unavailable" }, auth.cors); }
    return workflowApiJson(200, { data: [], next_cursor: null }, auth.cors);
  }

  let query = auth.admin
    .from("recon_exceptions")
    .select(
      "id,run_id,reason,severity,status,lifecycle_state,priority,due_date,root_cause,tags,assignee,side,payload,created_at,updated_at",
    )
    .eq("tenant_id", auth.principal.tenantId)
    .in("run_id", runIds)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (state) query = query.eq("lifecycle_state", state);
  if (assignee) query = query.eq("assignee", assignee);
  const cursor = url.searchParams.get("cursor");
  if (cursor) query = query.lt("created_at", cursor);
  const { data, error } = await query;
  if (error) return workflowApiJson(503, { error: "break_lookup_unavailable" }, auth.cors);
  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  try {
    await writePublicApiAudit({ admin: auth.admin, principal: auth.principal, tenantSlug, action: "api.break.list", resourceType: "recon_definition", resourceId: reconId, context: { count: page.length, ...publicApiRequestContext(request) } });
  } catch { return workflowApiJson(503, { error: "break_audit_unavailable" }, auth.cors); }
  return workflowApiJson(
    200,
    {
      data: page,
      next_cursor: hasMore ? (page.at(-1)?.created_at ?? null) : null,
    },
    auth.cors,
  );
}

export async function getPublicBreak(
  request: Request,
  tenantSlug: string,
  reconId: string,
  breakId: string,
) {
  const auth = await authorizeTenantApiRequest({
    request,
    tenantSlug,
    requiredScope: "recons.read",
    methods: "GET",
  });
  if (!auth.ok) return auth.response;
  if (!uuid.safeParse(reconId).success || !uuid.safeParse(breakId).success) {
    return workflowApiJson(400, { error: "invalid_resource_id" }, auth.cors);
  }
  let item;
  try {
    item = await getScopedBreak(auth.admin, auth.principal.tenantId, reconId, breakId);
  } catch {
    return workflowApiJson(503, { error: "break_lookup_unavailable" }, auth.cors);
  }
  if (!item) return workflowApiJson(404, { error: "break_not_found" }, auth.cors);
  const [comments, attachments, notes, writeOffs, audits] = await Promise.all([
    auth.admin
      .from("break_comments")
      .select("id,body,internal,author_id,created_at")
      .eq("tenant_id", auth.principal.tenantId)
      .eq("exception_id", breakId)
      .order("created_at"),
    auth.admin
      .from("break_attachments")
      .select("id,filename,mime_type,size_bytes,created_at,uploader_id")
      .eq("tenant_id", auth.principal.tenantId)
      .eq("exception_id", breakId)
      .order("created_at"),
    auth.admin
      .from("break_notes")
      .select("id,note_date,category,comment,amount,currency,status,author,created_at,updated_at")
      .eq("tenant_id", auth.principal.tenantId)
      .eq("break_id", breakId)
      .order("note_date"),
    auth.admin
      .from("break_write_off_requests")
      .select(
        "id,amount,currency,gl_account,reason,status,requested_by,decided_by,decided_at,decision_note,created_at",
      )
      .eq("tenant_id", auth.principal.tenantId)
      .eq("exception_id", breakId)
      .order("created_at"),
    auth.admin
      .from("audit_log")
      .select("id,action,actor_user_id,occurred_at,context")
      .eq("tenant_id", auth.principal.tenantId)
      .eq("resource_id", breakId)
      .order("occurred_at"),
  ]);
  if ([comments, attachments, notes, writeOffs, audits].some((result) => result.error)) {
    return workflowApiJson(503, { error: "break_evidence_unavailable" }, auth.cors);
  }
  try {
    await writePublicApiAudit({ admin: auth.admin, principal: auth.principal, tenantSlug, action: "api.break.read", resourceType: "recon_exception", resourceId: breakId, context: { recon_id: reconId, ...publicApiRequestContext(request) } });
  } catch { return workflowApiJson(503, { error: "break_audit_unavailable" }, auth.cors); }
  return workflowApiJson(
    200,
    {
      data: item,
      comments: comments.data ?? [],
      attachments: attachments.data ?? [],
      notes: notes.data ?? [],
      write_off_requests: writeOffs.data ?? [],
      audit: audits.data ?? [],
    },
    auth.cors,
  );
}

export async function actionPublicBreak(
  request: Request,
  tenantSlug: string,
  reconId: string,
  breakId: string,
) {
  const auth = await authorizeTenantApiRequest({
    request,
    tenantSlug,
    requiredScope: "breaks.write",
    methods: "POST",
  });
  if (!auth.ok) return auth.response;
  if (!uuid.safeParse(reconId).success || !uuid.safeParse(breakId).success) {
    return workflowApiJson(400, { error: "invalid_resource_id" }, auth.cors);
  }
  const idempotency = requirePublicIdempotencyKey(request, auth.cors);
  if (!idempotency.ok) return idempotency.response;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return workflowApiJson(400, { error: "invalid_json" }, auth.cors);
  }
  const parsed = parsePublicBreakAction(raw);
  if (!parsed.success)
    return workflowApiJson(
      422,
      { error: "validation_error", details: parsed.error.flatten() },
      auth.cors,
    );
  if (
    parsed.data.action === "reprocess" &&
    !hasWorkflowScope(auth.principal.scopes, "recons.run")
  ) {
    return workflowApiJson(403, { error: "missing_scope", required: "recons.run" }, auth.cors);
  }

  let item;
  try {
    item = await getScopedBreak(auth.admin, auth.principal.tenantId, reconId, breakId);
  } catch {
    return workflowApiJson(503, { error: "break_lookup_unavailable" }, auth.cors);
  }
  if (!item) return workflowApiJson(404, { error: "break_not_found" }, auth.cors);

  const operation = `break:${breakId}:${parsed.data.action}`;
  const claim = await claimPublicMutation({
    admin: auth.admin,
    principal: auth.principal,
    operation,
    idempotencyKey: idempotency.key,
    requestBody: parsed.data,
    headers: auth.cors,
  });
  if (!claim.ok) return claim.response;

  const now = new Date().toISOString();
  const action = parsed.data;
  let responseStatus = 200;
  let responseBody: Record<string, unknown>;
  try {
    if (action.action === "comment") {
      const id = publicApiDeterministicUuid(
        auth.principal.tokenId,
        operation,
        idempotency.key,
        claim.requestHash,
      );
      const { data, error } = await auth.admin
        .from("break_comments")
        .upsert(
          {
            id,
            tenant_id: auth.principal.tenantId,
            exception_id: breakId,
            author_id: auth.principal.actorUserId,
            body: action.body,
            internal: action.internal,
          },
          { onConflict: "id" },
        )
        .select("id,created_at")
        .single();
      if (error) throw error;
      responseStatus = 201;
      responseBody = { data };
    } else if (action.action === "attach") {
      const id = publicApiDeterministicUuid(
        auth.principal.tokenId,
        operation,
        idempotency.key,
        claim.requestHash,
      );
      const { data, error } = await auth.admin
        .from("break_attachments")
        .upsert(
          {
            id,
            tenant_id: auth.principal.tenantId,
            exception_id: breakId,
            uploader_id: auth.principal.actorUserId,
            filename: action.filename,
            mime_type: action.mime_type ?? null,
            size_bytes: action.size_bytes ?? null,
            storage_path: null,
          },
          { onConflict: "id" },
        )
        .select("id,created_at")
        .single();
      if (error) throw error;
      responseStatus = 201;
      responseBody = { data };
    } else if (action.action === "write_off") {
      const { data, error } = await auth.admin.rpc("request_break_write_off", {
        _tenant_id: auth.principal.tenantId,
        _exception_id: breakId,
        _requester_id: auth.principal.actorUserId,
        _amount: action.amount,
        _currency: action.currency,
        _gl_account: action.gl_account,
        _reason: action.reason,
      });
      if (error || !data?.[0]) throw error ?? new Error("request unavailable");
      responseStatus = 202;
      responseBody = { data: data[0] };
    } else if (action.action === "approve_write_off") {
      const { data, error } = await auth.admin.rpc("decide_break_write_off", {
        _tenant_id: auth.principal.tenantId,
        _request_id: action.request_id,
        _approver_id: auth.principal.actorUserId,
        _decision: action.decision,
        _decision_note: action.decision_note,
      });
      if (error || !data?.[0]) throw error ?? new Error("decision unavailable");
      responseBody = { data: data[0] };
    } else if (action.action === "reprocess") {
      const { data, error } = await auth.admin.rpc("enqueue_workflow_api_job", {
        _tenant_id: auth.principal.tenantId,
        _token_id: auth.principal.tokenId,
        _actor_user_id: auth.principal.actorUserId,
        _job_kind: "recon_run",
        _resource_id: reconId,
        _idempotency_key: `break:${breakId}:${idempotency.key}`,
      });
      if (error || !data?.[0]) throw error ?? new Error("queue unavailable");
      responseStatus = data[0].job_status === "succeeded" ? 200 : 202;
      responseBody = { api_version: "v1", job_id: data[0].job_id, status: data[0].job_status };
    } else {
      const patch: Record<string, unknown> = {};
      if (action.action === "assign")
        Object.assign(patch, {
          assignee: action.assignee,
          assigned_at: action.assignee ? now : null,
          assigned_by: action.assignee ? auth.principal.actorUserId : null,
          lifecycle_state: action.assignee ? "assigned" : "new",
        });
      if (action.action === "classify")
        Object.assign(patch, {
          root_cause: action.root_cause,
          priority: action.priority ?? item.priority,
          tags: action.tags ?? item.tags,
          lifecycle_state: "investigating",
        });
      if (action.action === "resolve")
        Object.assign(patch, {
          lifecycle_state: "resolved",
          status: "resolved",
          resolved_at: now,
          resolved_by: auth.principal.actorUserId,
          resolution_note: action.resolution_note,
          ...(action.root_cause ? { root_cause: action.root_cause } : {}),
        });
      if (action.action === "reopen")
        Object.assign(patch, {
          lifecycle_state: "new",
          status: "open",
          reopen_reason: action.reason,
          reopened_at: now,
          resolved_at: null,
          resolved_by: null,
        });
      const { data, error } = await auth.admin
        .from("recon_exceptions")
        .update(patch)
        .eq("tenant_id", auth.principal.tenantId)
        .eq("id", breakId)
        .select("id,lifecycle_state,status,priority,assignee,root_cause,tags,updated_at")
        .single();
      if (error) throw error;
      responseBody = { data };
    }

    await writePublicApiAudit({
      admin: auth.admin,
      principal: auth.principal,
      tenantSlug,
      action: `api.break.${action.action}`,
      resourceType: "recon_exception",
      resourceId: breakId,
      context: { recon_id: reconId, idempotency_key: idempotency.key, ...publicApiRequestContext(request) },
    });
    await completePublicMutation({
      admin: auth.admin,
      principal: auth.principal,
      operation,
      idempotencyKey: idempotency.key,
      requestHash: claim.requestHash,
      responseStatus,
      responseBody,
    });
  } catch (error) {
    const failure = classifyPublicBreakActionFailure(action, error);
    try {
      await completePublicMutation({
        admin: auth.admin,
        principal: auth.principal,
        operation,
        idempotencyKey: idempotency.key,
        requestHash: claim.requestHash,
        responseStatus: failure.status,
        responseBody: failure.body,
      });
    } catch {
      return workflowApiJson(503, { error: "idempotency_unavailable" }, auth.cors);
    }
    return workflowApiJson(failure.status, failure.body, auth.cors);
  }
  return workflowApiJson(responseStatus, responseBody, {
    ...auth.cors,
    ...(responseStatus === 202 ? { "retry-after": "2" } : {}),
  });
}

export function publicBreakCors(request: Request, methods: string) {
  return workflowApiCors(request, methods);
}
