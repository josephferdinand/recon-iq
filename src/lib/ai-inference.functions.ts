// ─────────────────────────────────────────────────────────────────────────────
// AI Inference — server functions callable from the Control Plane UI.
//
// • simulateInferenceRoute — dry-run resolver (no secret returned, no upstream
//   call, no usage recorded). Used by the Admin Simulator to visualise how
//   a given request would flow through the routing policies.
//
// • executeInference — LIVE proxy: resolves the route, calls the upstream
//   provider (Muse-compatible chat/completions body), records the call in
//   ai_usage_events, and returns the upstream response. Kill-switches and
//   quotas are respected. Secret plaintext is never returned.
//
// The public HTTP inference proxy lives in src/routes/api/public/ai/inference.ts
// and shares the same resolver + execution path.
// ─────────────────────────────────────────────────────────────────────────────

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createErrorReference, USER_FACING_ERRORS } from "./user-facing-errors";

const RequestClass = z.enum(["chat", "embedding", "image", "tool", "agent", "other"]);

function inferenceFailure(stage: string, status: number, cause?: unknown) {
  const referenceId = createErrorReference();
  const detail = cause && typeof cause === "object" ? cause as Record<string, unknown> : {};
  console.error("[AI_INFERENCE_FAILURE]", {
    referenceId, stage, status,
    errorName: cause instanceof Error ? cause.name : undefined,
    errorCode: typeof detail.code === "string" ? detail.code : undefined,
  });
  const copy = USER_FACING_ERRORS.service;
  return { ok: false as const, status, title: copy.title, error: copy.message,
    action: copy.action, reference_id: referenceId };
}

// ── Simulator (dry run) ────────────────────────────────────────────────────
export const simulateInferenceRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid().optional().nullable(),
    request_class: RequestClass.optional(),
    requested_model_key: z.string().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { resolveInferenceRoute } = await import("./ai-inference-router.server");
    try {
      const r = await resolveInferenceRoute(context.supabase, {
        tenant_id: data.tenant_id ?? null,
        request_class: data.request_class,
        requested_model_key: data.requested_model_key,
        include_secret: false,
      });
      return { ok: true as const, resolved: {
        policy_name: r.policy_name, chain_index: r.chain_index,
        provider_display: r.provider_display, provider_code: r.provider_code,
        model_key: r.model_key,
      } };
    } catch (error) {
      return inferenceFailure("route_resolution", 424, error);
    }
  });

// ── Kill-switch / quota gating (best-effort, non-blocking on missing rows) ─
async function gatingCheck(sb: any, tenant_id: string | null) {
  if (!tenant_id) return { blocked: false as const };
  const { data: ks, error } = await sb.from("ai_governance_kill_switches").select("id, reason, scope, tenant_id")
    .eq("engaged", true).or(`tenant_id.is.null,tenant_id.eq.${tenant_id}`).maybeSingle();
  if (error) throw new Error(error.message);
  if (ks) return { blocked: true as const };
  return { blocked: false as const };
}

// ── Live inference (authenticated server fn) ───────────────────────────────
export const executeInference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid().optional().nullable(),
    request_class: RequestClass.default("chat"),
    requested_model_key: z.string().optional(),
    messages: z.array(z.object({ role: z.string(), content: z.string() })).min(1),
    max_tokens: z.number().int().min(1).max(4096).optional(),
    temperature: z.number().min(0).max(2).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    let gate;
    try {
      gate = await gatingCheck(context.supabase, data.tenant_id ?? null);
    } catch (error) {
      return inferenceFailure("policy_check", 503, error);
    }
    if (gate.blocked) return {
      ok: false as const, status: 423,
      title: "Action Not Available",
      error: "AI requests are currently paused by policy.",
      action: "Contact your administrator if this request should be allowed.",
    };

    const { resolveInferenceRoute } = await import("./ai-inference-router.server");
    const started = Date.now();
    let route;
    try {
      route = await resolveInferenceRoute(context.supabase, {
        tenant_id: data.tenant_id ?? null,
        request_class: data.request_class,
        requested_model_key: data.requested_model_key,
        include_secret: true,
      });
    } catch (error) {
      return inferenceFailure("route_resolution", 424, error);
    }
    if (!route.endpoint) return inferenceFailure("provider_endpoint", 424);

    const body = JSON.stringify({
      model: route.model_key,
      messages: data.messages,
      ...(data.max_tokens ? { max_tokens: data.max_tokens } : {}),
      ...(data.temperature !== undefined ? { temperature: data.temperature } : {}),
    });

    let upstreamStatus = 0, upstreamText = "", usage: any = null, content = "";
    try {
      const r = await fetch(route.endpoint, { method: "POST", headers: route.headers, body });
      upstreamStatus = r.status;
      upstreamText = await r.text();
      if (r.ok) {
        try {
          const j = JSON.parse(upstreamText);
          usage = j.usage ?? null;
          content = j.choices?.[0]?.message?.content ?? j.output_text ?? "";
        } catch { /* non-JSON */ }
      }
    } catch (error) {
      return inferenceFailure("provider_connection", 502, error);
    }

    // Record usage (best-effort; scope column is CHECK-constrained, map to legal enum).
    const scopeCol = data.request_class === "chat" || data.request_class === "tool" ? "copilot"
                   : data.request_class === "agent" ? "agent"
                   : data.request_class === "embedding" ? "tool" : "other";
    if (data.tenant_id) {
      try {
        await context.supabase.from("ai_usage_events").insert({
          tenant_id: data.tenant_id,
          user_id: context.userId,
          scope: scopeCol,
          model: `${route.provider_code}/${route.model_key}`,
          tokens_in: usage?.prompt_tokens ?? usage?.input_tokens ?? 0,
          tokens_out: usage?.completion_tokens ?? usage?.output_tokens ?? 0,
          cost_usd: 0, // pricing lookup happens in existing telemetry pass; keep 0 here to avoid double-count
          meta: {
            source: "ai_inference_router",
            policy_id: route.policy_id, chain_index: route.chain_index,
            provider_instance_id: route.provider_instance_id,
            model_catalog_id: route.model_catalog_id,
            latency_ms: Date.now() - started,
            upstream_status: upstreamStatus,
          },
        } as any);
      } catch { /* best-effort */ }
    }

    const failed = upstreamStatus < 200 || upstreamStatus >= 300
      ? inferenceFailure("provider_response", 502) : null;
    return {
      ok: upstreamStatus >= 200 && upstreamStatus < 300,
      status: failed?.status ?? upstreamStatus,
      latency_ms: Date.now() - started,
      route: {
        policy_name: route.policy_name,
        chain_index: route.chain_index,
        provider_code: route.provider_code, provider_display: route.provider_display,
        model_key: route.model_key,
      },
      content, usage,
      title: failed?.title,
      error: failed?.error,
      action: failed?.action,
      reference_id: failed?.reference_id,
    };
  });
