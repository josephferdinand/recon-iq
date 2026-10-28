import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { workflowApiJson, type TokenPrincipal } from "@/lib/public-workflow-api.server";

export function publicApiRequestHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function publicApiDeterministicUuid(...parts: string[]) {
  const hex = createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

export function requirePublicIdempotencyKey(request: Request, headers: Record<string, string>) {
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!key || key.length > 128) {
    return {
      ok: false as const,
      response: workflowApiJson(400, { error: "valid_idempotency_key_required" }, headers),
    };
  }
  return { ok: true as const, key };
}

export function publicApiRequestContext(request: Request) {
  const requestId = request.headers.get("x-fvi-request-id")?.trim() ?? "";
  const client = request.headers.get("x-fvi-client")?.trim() ?? "";
  return {
    ...(client === "mcp-gateway-v1" ? { api_client: client } : {}),
    ...(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestId)
      ? { api_request_id: requestId }
      : {}),
  };
}

export async function claimPublicMutation(args: {
  admin: SupabaseClient;
  principal: TokenPrincipal;
  operation: string;
  idempotencyKey: string;
  requestBody: unknown;
  headers: Record<string, string>;
}) {
  const requestHash = publicApiRequestHash(args.requestBody);
  const { data, error } = await args.admin.rpc("claim_public_api_idempotency", {
    _tenant_id: args.principal.tenantId,
    _token_id: args.principal.tokenId,
    _operation: args.operation,
    _idempotency_key: args.idempotencyKey,
    _request_hash: requestHash,
  });
  if (error) {
    return {
      ok: false as const,
      response: workflowApiJson(503, { error: "idempotency_unavailable" }, args.headers),
    };
  }
  const claim = Array.isArray(data) ? data[0] : data;
  if (claim?.claim_state === "conflict") {
    return {
      ok: false as const,
      response: workflowApiJson(409, { error: "idempotency_conflict" }, args.headers),
    };
  }
  if (claim?.claim_state === "in_progress") {
    return {
      ok: false as const,
      response: workflowApiJson(409, { error: "request_in_progress" }, {
        ...args.headers,
        "retry-after": "2",
      }),
    };
  }
  if (claim?.claim_state === "replay") {
    return {
      ok: false as const,
      response: workflowApiJson(
        Number(claim.stored_status ?? 200),
        claim.stored_body ?? {},
        { ...args.headers, "idempotent-replay": "true" },
      ),
    };
  }
  if (claim?.claim_state !== "claimed") {
    return {
      ok: false as const,
      response: workflowApiJson(503, { error: "idempotency_unavailable" }, args.headers),
    };
  }
  return { ok: true as const, requestHash };
}

export async function completePublicMutation(args: {
  admin: SupabaseClient;
  principal: TokenPrincipal;
  operation: string;
  idempotencyKey: string;
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
}) {
  const { error } = await args.admin.rpc("complete_public_api_idempotency", {
    _tenant_id: args.principal.tenantId,
    _token_id: args.principal.tokenId,
    _operation: args.operation,
    _idempotency_key: args.idempotencyKey,
    _request_hash: args.requestHash,
    _response_status: args.responseStatus,
    _response_body: args.responseBody,
  });
  if (error) throw new Error("Unable to persist idempotent response");
}

export async function writePublicApiAudit(args: {
  admin: SupabaseClient;
  principal: TokenPrincipal;
  tenantSlug: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  context?: Record<string, unknown>;
}) {
  const idempotencyKey = args.context?.idempotency_key;
  if (typeof idempotencyKey === "string") {
    const { data: existing, error: lookupError } = await args.admin.from("audit_log")
      .select("id")
      .eq("tenant_id", args.principal.tenantId)
      .eq("action", args.action)
      .eq("resource_id", args.resourceId)
      .contains("context", { api_token_id: args.principal.tokenId, idempotency_key: idempotencyKey })
      .limit(1);
    if (lookupError) throw new Error("Unable to check API audit replay");
    if (existing?.length) return;
  }
  const { error } = await args.admin.from("audit_log").insert({
    tenant_id: args.principal.tenantId,
    tenant_slug: args.tenantSlug,
    actor_user_id: args.principal.actorUserId,
    scope: "api",
    action: args.action,
    resource_type: args.resourceType,
    resource_id: args.resourceId,
    context: {
      ...(args.context ?? {}),
      api_token_id: args.principal.tokenId,
    },
  } as never);
  if (error) throw new Error("Unable to write API audit event");
}
