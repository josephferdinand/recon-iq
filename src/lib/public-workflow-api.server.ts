import { createHash } from "node:crypto";
import { getPublicCorsOrigin } from "@/lib/public-cors";
import type { SupabaseClient } from "@supabase/supabase-js";

export type WorkflowJobKind =
  | "data_prep_run"
  | "recon_run"
  | "connector_run"
  | "connector_agent_run";

export function workflowScopeForJobKind(jobKind: WorkflowJobKind): string {
  if (jobKind === "data_prep_run") return "data-prep.run";
  if (jobKind === "connector_run" || jobKind === "connector_agent_run") return "connectors.run";
  return "recons.run";
}

export type TokenPrincipal = {
  tokenId: string;
  tenantId: string;
  actorUserId: string;
  scopes: string[];
  expiresAt: string | null;
};

export function workflowApiCors(request: Request, methods: string) {
  const origin = getPublicCorsOrigin(request.headers.get("origin"));
  return {
    ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
    "access-control-allow-methods": `${methods}, OPTIONS`,
    "access-control-allow-headers": "authorization, content-type, idempotency-key",
    "access-control-max-age": "86400",
    "cache-control": "no-store",
  };
}

export function workflowApiJson(status: number, body: unknown, headers?: Record<string, string>) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...(headers ?? {}) },
  });
}

export function extractWorkflowBearer(request: Request) {
  const match = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/iu);
  return match?.[1]?.trim() ?? "";
}

export function hasWorkflowScope(scopes: string[], required: string) {
  return scopes.includes("*") || scopes.includes(required);
}

export async function authenticateWorkflowToken(
  request: Request,
  requiredScope?: string,
  responseHeaders?: Record<string, string>,
): Promise<
  | { ok: true; principal: TokenPrincipal; admin: SupabaseClient }
  | { ok: false; response: Response }
> {
  const raw = extractWorkflowBearer(request);
  if (!raw) return { ok: false, response: workflowApiJson(401, { error: "missing_bearer" }, responseHeaders) };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const tokenHash = createHash("sha256").update(raw).digest("hex");
  const { data: row, error } = await supabaseAdmin
    .from("api_tokens")
    .select("id,tenant_id,created_by,scopes,expires_at,revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) return { ok: false, response: workflowApiJson(503, { error: "authentication_unavailable" }, responseHeaders) };
  if (!row || row.revoked_at) return { ok: false, response: workflowApiJson(401, { error: "invalid_token" }, responseHeaders) };
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    return { ok: false, response: workflowApiJson(401, { error: "token_expired" }, responseHeaders) };
  }
  if (!row.created_by) {
    return { ok: false, response: workflowApiJson(403, { error: "unaccountable_token" }, responseHeaders) };
  }
  const scopes = Array.isArray(row.scopes) ? row.scopes : [];
  if (requiredScope && !hasWorkflowScope(scopes, requiredScope)) {
    return {
      ok: false,
      response: workflowApiJson(403, { error: "missing_scope", required: requiredScope }, responseHeaders),
    };
  }
  const { error: touchError } = await supabaseAdmin
    .from("api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id);
  if (touchError) {
    return { ok: false, response: workflowApiJson(503, { error: "authentication_unavailable" }, responseHeaders) };
  }
  return {
    ok: true,
    principal: {
      tokenId: row.id,
      tenantId: row.tenant_id,
      actorUserId: row.created_by,
      scopes,
      expiresAt: row.expires_at,
    },
    admin: supabaseAdmin,
  };
}

export async function introspectWorkflowToken(request: Request) {
  const auth = await authenticateWorkflowToken(request);
  if (!auth.ok) return auth.response;
  const { principal, admin } = auth;
  const { data: rate, error: rateError } = await admin.rpc("rate_limit_hit", {
    _key: `public-api:${principal.tokenId}:introspect`,
    _window_seconds: 60,
    _limit: 120,
  });
  const limit = Array.isArray(rate) ? rate[0] : rate;
  if (rateError) return workflowApiJson(503, { error: "rate_limit_unavailable" });
  if (!limit?.allowed) {
    const retry = Number(limit?.retry_after_seconds ?? 60);
    return workflowApiJson(429, { error: "rate_limit_exceeded", retry_after_seconds: retry }, {
      "retry-after": String(retry),
    });
  }
  const { data: tenant, error } = await admin
    .from("tenants")
    .select("slug")
    .eq("id", principal.tenantId)
    .maybeSingle();
  if (error) return workflowApiJson(503, { error: "tenant_lookup_unavailable" });
  if (!tenant) return workflowApiJson(401, { error: "invalid_token" });
  return workflowApiJson(200, {
    active: true,
    tenant_slug: tenant.slug,
    subject: principal.actorUserId,
    scopes: principal.scopes,
    expires_at: principal.expiresAt,
  });
}

export async function authorizeTenantApiRequest(args: {
  request: Request;
  tenantSlug: string;
  requiredScope: string;
  methods: string;
  rateLimit?: number;
}) {
  const cors = workflowApiCors(args.request, args.methods);
  const auth = await authenticateWorkflowToken(args.request, args.requiredScope, cors);
  if (!auth.ok) return auth;

  const { principal, admin } = auth;
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("id,slug,name")
    .eq("id", principal.tenantId)
    .eq("slug", args.tenantSlug)
    .maybeSingle();
  if (tenantError) {
    return { ok: false as const, response: workflowApiJson(503, { error: "tenant_lookup_unavailable" }, cors) };
  }
  if (!tenant) {
    return { ok: false as const, response: workflowApiJson(403, { error: "tenant_scope_mismatch" }, cors) };
  }

  const { data: limit, error: limitError } = await admin.rpc("rate_limit_hit", {
    _key: `public-api:${principal.tokenId}:${args.requiredScope}`,
    _window_seconds: 60,
    _limit: args.rateLimit ?? (args.methods.includes("GET") ? 120 : 60),
  });
  if (limitError) {
    return { ok: false as const, response: workflowApiJson(503, { error: "rate_limit_unavailable" }, cors) };
  }
  const rate = Array.isArray(limit) ? limit[0] : limit;
  if (!rate?.allowed) {
    const retry = Number(rate?.retry_after_seconds ?? 60);
    return {
      ok: false as const,
      response: workflowApiJson(429, { error: "rate_limit_exceeded", retry_after_seconds: retry }, {
        ...cors,
        "retry-after": String(retry),
      }),
    };
  }

  return { ok: true as const, principal, admin, tenant, cors };
}

export async function queueWorkflowApiJob(args: {
  request: Request;
  tenantSlug: string;
  resourceId: string;
  jobKind: WorkflowJobKind;
  requiredScope: string;
}) {
  const cors = workflowApiCors(args.request, "POST");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(args.resourceId)) {
    return workflowApiJson(400, { error: "invalid_resource_id" }, cors);
  }
  const idempotencyKey = args.request.headers.get("idempotency-key")?.trim() ?? "";
  if (!idempotencyKey || idempotencyKey.length > 128) {
    return workflowApiJson(400, { error: "valid_idempotency_key_required" }, cors);
  }

  const auth = await authenticateWorkflowToken(args.request, args.requiredScope, cors);
  if (!auth.ok) return auth.response;
  const { principal, admin } = auth;
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("id,slug")
    .eq("id", principal.tenantId)
    .eq("slug", args.tenantSlug)
    .maybeSingle();
  if (tenantError) return workflowApiJson(503, { error: "tenant_lookup_unavailable" }, cors);
  if (!tenant) return workflowApiJson(403, { error: "tenant_scope_mismatch" }, cors);

  const { data: limit, error: limitError } = await admin.rpc("rate_limit_hit", {
    _key: `workflow-api:${principal.tokenId}:${args.jobKind}`,
    _window_seconds: 60,
    _limit: 60,
  });
  if (limitError) return workflowApiJson(503, { error: "rate_limit_unavailable" }, cors);
  const rate = Array.isArray(limit) ? limit[0] : limit;
  if (!rate?.allowed) {
    const retry = Number(rate?.retry_after_seconds ?? 60);
    return workflowApiJson(429, { error: "rate_limit_exceeded", retry_after_seconds: retry }, {
      ...cors,
      "retry-after": String(retry),
    });
  }

  const { data: rows, error: enqueueError } = await admin.rpc("enqueue_workflow_api_job", {
    _tenant_id: principal.tenantId,
    _token_id: principal.tokenId,
    _actor_user_id: principal.actorUserId,
    _job_kind: args.jobKind,
    _resource_id: args.resourceId,
    _idempotency_key: idempotencyKey,
  });
  if (enqueueError || !rows?.[0]) {
    const message = enqueueError?.message ?? "queue unavailable";
    const notFound = /not found/iu.test(message);
    return workflowApiJson(notFound ? 404 : 503, { error: notFound ? "resource_not_found" : "queue_unavailable" }, cors);
  }
  const job = rows[0];
  return workflowApiJson(job.job_status === "succeeded" ? 200 : 202, {
    api_version: "v1",
    job_id: job.job_id,
    status: job.job_status,
    idempotent_replay: job.idempotent_replay,
  }, {
    ...cors,
    location: `/api/v1/${args.tenantSlug}/workflow-jobs/${job.job_id}`,
    "retry-after": "2",
    ...(job.idempotent_replay ? { "idempotent-replay": "true" } : {}),
  });
}

export async function getWorkflowApiJob(request: Request, tenantSlug: string, jobId: string) {
  const cors = workflowApiCors(request, "GET");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(jobId)) {
    return workflowApiJson(400, { error: "invalid_job_id" }, cors);
  }
  const auth = await authenticateWorkflowToken(request, undefined, cors);
  if (!auth.ok) return auth.response;
  const { principal, admin } = auth;
  const { data: tenant } = await admin.from("tenants").select("id").eq("id", principal.tenantId).eq("slug", tenantSlug).maybeSingle();
  if (!tenant) return workflowApiJson(403, { error: "tenant_scope_mismatch" }, cors);
  const { data: job, error } = await admin
    .from("workflow_api_jobs")
    .select("id,job_kind,resource_id,status,attempts,max_attempts,result,error_code,created_at,updated_at,completed_at")
    .eq("id", jobId)
    .eq("tenant_id", principal.tenantId)
    .maybeSingle();
  if (error) return workflowApiJson(503, { error: "job_lookup_unavailable" }, cors);
  if (!job) return workflowApiJson(404, { error: "job_not_found" }, cors);
  const requiredScope = workflowScopeForJobKind(job.job_kind as WorkflowJobKind);
  if (!hasWorkflowScope(principal.scopes, requiredScope)) {
    return workflowApiJson(403, { error: "missing_scope", required: requiredScope }, cors);
  }
  return workflowApiJson(200, {
    api_version: "v1",
    job_id: job.id,
    job_kind: job.job_kind,
    resource_id: job.resource_id,
    status: job.status,
    attempts: job.attempts,
    max_attempts: job.max_attempts,
    result: job.status === "succeeded" ? job.result : undefined,
    error: job.status === "failed" || job.status === "dead" ? job.error_code : undefined,
    created_at: job.created_at,
    updated_at: job.updated_at,
    completed_at: job.completed_at,
  }, {
    ...cors,
    ...(job.status === "queued" || job.status === "running" ? { "retry-after": "2" } : {}),
  });
}
