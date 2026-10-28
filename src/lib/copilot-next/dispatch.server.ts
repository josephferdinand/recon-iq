import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { CopilotRefusal, providerCount, safeRefusal } from "./contracts";

const reservationSchema = z.object({
  reservation_id: z.string().uuid(), max_input_tokens: z.number().int().positive(), max_output_tokens: z.number().int().positive(),
  provider: z.string().min(1), model_key: z.string().min(1), base_url: z.string().nullable(), key_secret_name: z.string().nullable(),
});
export type DispatchBinding = { id: string; provider: string; model: string; baseUrl: string; keyName: string; maxOutputTokens: number };

// One reservation per actual SDK HTTP call; no retries, fallback inference or release of uncertain spend.
export function governedDispatch(sb: SupabaseClient, tenantId: string | null, binding: DispatchBinding, upstream: typeof fetch = fetch) {
  const pending: string[] = [];
  const attempts: Array<{ id: string; state: "held" | "settled"; tokensIn: number | null; tokensOut: number | null }> = [];
  let settled = 0;
  const guardedFetch: typeof fetch = async (input, init) => {
    if (pending.length) throw new CopilotRefusal(503, "copilot.unsettled_step", "The previous AI step has unresolved usage. Check the conversation before retrying.");
    if (init?.signal?.aborted) throw new CopilotRefusal(499, "copilot.cancelled", "Request cancelled.");
    const attemptId = crypto.randomUUID();
    // Record the attempt before the RPC: a lost reservation response may have committed.
    attempts.push({ id: attemptId, state: "held", tokensIn: null, tokensOut: null });
    pending.push(attemptId);
    let result;
    try { result = await (sb as any).rpc("reserve_copilot_dispatch", { _attempt_id: attemptId, _provider_id: binding.id, _tenant_id: tenantId }); }
    catch { throw safeRefusal(null); }
    if (result.error) throw safeRefusal(result.error);
    const parsed = reservationSchema.safeParse(result.data);
    // A successful but malformed/changed reservation is uncertain: retain its hold, do not dispatch.
    if (!parsed.success) throw new CopilotRefusal(503, "copilot.reservation_invalid", "AI reservation could not be verified.");
    const r = parsed.data;
    const normal = (url: string | null) => (url ?? "").trim().replace(/\/+$/, "");
    if (r.reservation_id !== attemptId || r.model_key !== binding.model || r.provider !== binding.provider ||
        normal(r.base_url) !== normal(binding.baseUrl) || (r.key_secret_name || r.provider).toUpperCase() !== binding.keyName)
      throw new CopilotRefusal(409, "copilot.binding_changed", "Provider configuration changed. Refresh the conversation.");
    if (typeof init?.body !== "string") throw new CopilotRefusal(400, "copilot.input_invalid", "Text requests only.");
    let body: Record<string, unknown>;
    try { body = JSON.parse(init.body); } catch { throw new CopilotRefusal(400, "copilot.input_invalid", "Text requests only."); }
    if (body.model !== binding.model || new TextEncoder().encode(init.body).length > r.max_input_tokens)
      throw new CopilotRefusal(413, "copilot.input_bound", "This conversation exceeds the model input limit. Start a new conversation.");
    const outputLimit = body.max_tokens ?? body.max_completion_tokens ?? body.max_output_tokens;
    if (providerCount(outputLimit) === null || Number(outputLimit) < 1 || Number(outputLimit) > Math.min(r.max_output_tokens, binding.maxOutputTokens))
      throw new CopilotRefusal(413, "copilot.output_bound", "The model output limit could not be verified.");
    const requestUrl = new URL(input instanceof Request ? input.url : String(input));
    const base = new URL(binding.baseUrl);
    if (requestUrl.origin !== base.origin || !requestUrl.pathname.startsWith(base.pathname.replace(/\/+$/, "") + "/"))
      throw new CopilotRefusal(424, "copilot.endpoint_changed", "The provider endpoint could not be verified.");
    // Redirects must never forward the provider credential to another origin.
    return upstream(input, { ...init, redirect: "error" });
  };
  async function settleStep(usage: { inputTokens?: unknown; outputTokens?: unknown }) {
    const attemptId = pending[0];
    const tokensIn = providerCount(usage.inputTokens), tokensOut = providerCount(usage.outputTokens);
    if (!attemptId || tokensIn === null || tokensOut === null || tokensIn + tokensOut === 0)
      throw new CopilotRefusal(503, "copilot.usage_unknown", "Provider usage is unavailable. The AI budget hold is retained.");
    let result;
    try { result = await (sb as any).rpc("settle_copilot_dispatch", { _attempt_id: attemptId, _tokens_in: tokensIn, _tokens_out: tokensOut }); }
    catch { throw new CopilotRefusal(503, "copilot.settlement_unavailable", "AI usage could not be recorded. The budget hold is retained."); }
    if (result.error || result.data?.settled !== true)
      throw new CopilotRefusal(503, "copilot.settlement_unavailable", "AI usage could not be recorded. The budget hold is retained.");
    pending.shift(); settled++;
    Object.assign(attempts.find(a => a.id === attemptId)!, { state: "settled", tokensIn, tokensOut });
  }
  return { fetch: guardedFetch, settleStep, attempts, complete: () => pending.length === 0 && settled > 0 };
}
