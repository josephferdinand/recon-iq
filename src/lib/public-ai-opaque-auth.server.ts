import { createHash } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolvedRoute } from "./ai-inference-router.server";

// This is an endpoint-specific service boundary, not a Supabase impersonation
// client. SQL derives the classified subject and rechecks current authority.
const uuid = z.string().uuid();
export const opaqueInferenceInput = z.object({
  tenant_id: uuid.optional(),
  request_class: z.enum(["chat", "embedding", "image", "tool", "agent", "other"]).default("chat"),
  model: z.string().min(1).max(256).optional(),
  messages: z.array(z.object({ role: z.string().min(1).max(32), content: z.string().max(65536) }).strict()).min(1).max(128),
  max_tokens: z.number().int().min(1).max(4096).default(4096),
  temperature: z.number().min(0).max(2).optional(),
}).strict().refine(value => value.messages.reduce((n, message) => n + message.content.length, 0) <= 65536);

const preparedSchema = z.object({
  request_id: uuid, token_id: uuid, tenant_id: uuid, subject_user_id: uuid,
  principal_kind: z.literal("user_delegated"),
  max_tokens: z.number().int().min(1).max(4096),
  max_input_tokens: z.number().int().positive(),
  route: z.object({
    policy_id: uuid, policy_name: z.string(), chain_index: z.number().int().nonnegative(),
    provider_instance_id: uuid, provider_code: z.string(), provider_display: z.string(),
    model_catalog_id: uuid, model_key: z.string(), endpoint: z.string(),
    auth_method: z.string(), custom_headers: z.record(z.string()), api_version: z.string().nullable(),
    vault_secret_id: uuid.nullable(),
  }),
  vault: z.object({
    ciphertext: z.string(), iv: z.string(), auth_tag: z.string(), wrapped_dek: z.string(),
    kek_provider: z.enum(["meta_managed", "aws_kms", "gcp_kms", "azure_kv", "hashicorp_vault", "cyberark_conjur"]), kek_ref: z.string(),
  }).nullable(),
});

const failures: Record<string, { status: number; error: string }> = {
  invalid_token: { status: 401, error: "unknown token" },
  token_revoked: { status: 401, error: "token revoked" },
  token_expired: { status: 401, error: "token expired" },
  missing_scope: { status: 403, error: "token lacks ai.inference scope" },
  principal_denied: { status: 403, error: "token principal not authorized" },
  tenant_scope_mismatch: { status: 403, error: "tenant scope mismatch" },
  ai_policy_denied: { status: 403, error: "AI request not authorized" },
  ai_paused: { status: 423, error: "AI requests are currently paused by policy" },
  rate_limit_exceeded: { status: 429, error: "Rate limit exceeded — please retry shortly" },
  route_unavailable: { status: 424, error: "provider endpoint not configured" },
  invalid_request: { status: 400, error: "invalid inference request" },
  "copilot.budget_reached": { status: 429, error: "AI budget limit reached" },
  "copilot.rate_limit": { status: 429, error: "Rate limit exceeded — please retry shortly" },
  "copilot.kill_switch": { status: 423, error: "AI requests are currently paused by policy" },
  "copilot.forbidden": { status: 403, error: "AI request not authorized" },
};

export class OpaqueInferenceError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export type PreparedOpaqueInference = {
  requestId: string; tokenId: string; tenantId: string; subjectUserId: string;
  route: ResolvedRoute; maxTokens: number; maxInputTokens: number;
};

export async function prepareOpaqueInference(admin: SupabaseClient, token: string, body: unknown): Promise<PreparedOpaqueInference> {
  const input = opaqueInferenceInput.safeParse(body);
  if (!input.success) throw new OpaqueInferenceError(400, "invalid inference request");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  let result;
  try {
    result = await admin.rpc("prepare_public_ai_inference" as never, {
      _token_hash: tokenHash, _tenant_id: input.data.tenant_id ?? null,
      _request_class: input.data.request_class, _model: input.data.model ?? null,
      _max_tokens: input.data.max_tokens,
    } as never);
  } catch { throw new OpaqueInferenceError(503, "authentication unavailable"); }
  if (result.error) {
    const known = failures[result.error.message];
    throw new OpaqueInferenceError(known?.status ?? 503, known?.error ?? "authentication unavailable");
  }
  const failure = result.data && typeof result.data === "object" && "error" in result.data
    ? failures[String((result.data as Record<string, unknown>).error)] : undefined;
  if (failure) throw new OpaqueInferenceError(failure.status, failure.error);
  const parsed = preparedSchema.safeParse(result.data);
  if (!parsed.success) throw new OpaqueInferenceError(503, "authentication unavailable");
  const p = parsed.data;
  if ((input.data.tenant_id && p.tenant_id !== input.data.tenant_id) ||
      p.max_tokens > input.data.max_tokens || (input.data.model && input.data.model !== p.route.model_key) ||
      Boolean(p.route.vault_secret_id) !== Boolean(p.vault)) {
    throw new OpaqueInferenceError(503, "authentication unavailable");
  }
  // Use the same conservative UTF-8 input fence as the existing dispatch
  // wrapper. The reservation holds the entire catalog allowance, never guesses.
  if (new TextEncoder().encode(JSON.stringify({ messages: input.data.messages })).length > p.max_input_tokens) {
    throw new OpaqueInferenceError(400, "inference input bound exceeded");
  }
  let secret: string | null = null;
  if (p.vault) {
    const { decryptSecret, pgByteaToBytes } = await import("./vault.server");
    try {
      secret = await decryptSecret({
        ciphertext: pgByteaToBytes(p.vault.ciphertext), iv: pgByteaToBytes(p.vault.iv),
        auth_tag: pgByteaToBytes(p.vault.auth_tag), wrapped_dek: pgByteaToBytes(p.vault.wrapped_dek),
        kek_provider: p.vault.kek_provider, kek_ref: p.vault.kek_ref,
      });
    } catch { throw new OpaqueInferenceError(424, "provider endpoint not configured"); }
  }
  const headers: Record<string, string> = { "content-type": "application/json", ...p.route.custom_headers };
  if (secret) {
    switch (p.route.auth_method) {
      case "api_key_header": headers["x-api-key"] = secret; break;
      case "azure_muse": headers["api-key"] = secret; break;
      case "anthropic": headers["x-api-key"] = secret; headers["anthropic-version"] = p.route.api_version ?? "2023-06-01"; break;
      default: headers.authorization = `Bearer ${secret}`;
    }
  }
  return {
    requestId: p.request_id, tokenId: p.token_id, tenantId: p.tenant_id, subjectUserId: p.subject_user_id,
    maxTokens: p.max_tokens, maxInputTokens: p.max_input_tokens,
    route: { ...p.route, headers, vault_last4: null, vault_fingerprint: null },
  };
}

export async function recordOpaqueInferenceUsage(
  admin: SupabaseClient, prepared: PreparedOpaqueInference,
  args: { usage: unknown; upstreamStatus: number; latencyMs: number },
) {
  const usage = args.usage && typeof args.usage === "object" ? args.usage as Record<string, unknown> : {};
  const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  let result;
  try {
    result = await admin.rpc("record_public_ai_inference_usage" as never, {
      _request_id: prepared.requestId,
      _tokens_in: count(usage.prompt_tokens ?? usage.input_tokens),
      _tokens_out: count(usage.completion_tokens ?? usage.output_tokens),
      _upstream_status: args.upstreamStatus, _latency_ms: Math.max(0, Math.floor(args.latencyMs)),
    } as never);
  } catch { throw new OpaqueInferenceError(503, "inference accounting unavailable"); }
  const { error, data } = result;
  if (error || data !== true) throw new OpaqueInferenceError(503, "inference accounting unavailable");
  const input = count(usage.prompt_tokens ?? usage.input_tokens);
  const output = count(usage.completion_tokens ?? usage.output_tokens);
  if ((input !== null && input > prepared.maxInputTokens) || (output !== null && output > prepared.maxTokens)) {
    // The overrun is already recorded; reporting it cannot reclaim its hold.
    throw new OpaqueInferenceError(502, "Inference request failed");
  }
}
