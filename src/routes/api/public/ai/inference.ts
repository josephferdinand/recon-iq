// ─────────────────────────────────────────────────────────────────────────────
// Public HTTP inference proxy — /api/public/ai/inference
//
// External callers authenticate with a bearer token minted from api_tokens
// (or a Supabase user JWT). The proxy resolves the route via the metadata
// resolver, calls the upstream, and records ai_usage_events. It never
// returns the vault plaintext.
//
// JWT requests use their authenticated RLS client. Opaque requests use only
// purpose-specific RPCs which derive the classified subject and enforce
// current actor/tenant authority; no anonymous fallback or forged JWT.
// ─────────────────────────────────────────────────────────────────────────────

import { createFileRoute } from "@tanstack/react-router";
import { getPublicCorsOrigin as getCorsOrigin } from "@/lib/public-cors";
import { OpaqueInferenceError, prepareOpaqueInference, recordOpaqueInferenceUsage, type PreparedOpaqueInference } from "@/lib/public-ai-opaque-auth.server";

function corsHeaders(origin: string | null): Record<string, string> {
  const base: Record<string, string> = {
    "content-type": "application/json",
  };
  if (origin) base["access-control-allow-origin"] = origin;
  return base;
}

export const Route = createFileRoute("/api/public/ai/inference")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const origin = getCorsOrigin(request.headers.get("origin"));
        return new Response(null, {
          status: 204,
          headers: {
            ...corsHeaders(origin),
            "access-control-allow-methods": "POST, OPTIONS",
            "access-control-allow-headers": "authorization, content-type",
            "access-control-max-age": "86400",
          },
        });
      },
      POST: async ({ request }) => {
        const requestOrigin = getCorsOrigin(request.headers.get("origin"));
        const cors = corsHeaders(requestOrigin);
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
        if (!token) return new Response(JSON.stringify({ error: "missing bearer" }), { status: 401, headers: cors });

        let body: any;
        try { body = await request.json(); }
        catch { return new Response(JSON.stringify({ error: "invalid json" }), { status: 400, headers: cors }); }

        const { createClient } = await import("@supabase/supabase-js");
        const url = process.env.SUPABASE_URL!;
        const srv = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const pub = process.env.SUPABASE_PUBLISHABLE_KEY!;
        if (!url || !pub) return new Response(JSON.stringify({ error: "server misconfigured" }), { status: 500, headers: cors });

        // Two auth modes: user JWT under RLS, or a classified opaque principal
        // through the AI-only preparation/accounting database contracts.
        let sb: any, actorTenantId: string | null = null, actorUserId: string | null = null;
        let opaque: PreparedOpaqueInference | null = null;
        if (token.split(".").length === 3) {
          sb = createClient(url, pub, { global: { headers: { authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
          const { data } = await sb.auth.getUser();
          if (!data?.user) return new Response(JSON.stringify({ error: "invalid jwt" }), { status: 401, headers: cors });
          actorUserId = data.user.id;
          actorTenantId = body.tenant_id ?? null;
        } else {
          if (!srv) return new Response(JSON.stringify({ error: "api-token auth disabled" }), { status: 501, headers: cors });
          sb = createClient(url, srv, { auth: { persistSession: false } });
          try { opaque = await prepareOpaqueInference(sb, token, body); }
          catch (error) {
            const failure = error instanceof OpaqueInferenceError ? error : new OpaqueInferenceError(503, "authentication unavailable");
            return new Response(JSON.stringify({ error: failure.message }), { status: failure.status, headers: cors });
          }
          actorTenantId = opaque.tenantId;
          actorUserId = opaque.subjectUserId;
        }

        const started = Date.now();
        let opaqueAccountingAttempted = false;
        try {
          const { resolveInferenceRoute } = await import("@/lib/ai-inference-router.server");
          const route = opaque?.route ?? await resolveInferenceRoute(sb, {
            tenant_id: actorTenantId,
            request_class: body.request_class ?? "chat",
            requested_model_key: body.model,
            include_secret: true,
          });
          if (!route.endpoint)
            return new Response(JSON.stringify({ error: "provider endpoint not configured" }), { status: 424, headers: cors });
          const proxyBody = JSON.stringify({
            model: route.model_key,
            messages: body.messages,
            ...(opaque ? { max_tokens: opaque.maxTokens } : body.max_tokens ? { max_tokens: body.max_tokens } : {}),
            ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
          });
          const r = await fetch(route.endpoint, { method: "POST", headers: route.headers, body: proxyBody });
          const text = await r.text();
          let usage: any = null, parsed: any = null;
          try { parsed = JSON.parse(text); usage = parsed.usage ?? null; } catch { /* pass-through */ }
          if (opaque) {
            opaqueAccountingAttempted = true;
            await recordOpaqueInferenceUsage(sb, opaque, { usage, upstreamStatus: r.status, latencyMs: Date.now() - started });
          } else if (actorTenantId) {
            try {
              const tokensIn = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
              const tokensOut = usage?.completion_tokens ?? usage?.output_tokens ?? 0;
              const { computeUsageCostUsd } = await import("@/lib/ai-cost.server");
              const { cost_usd, priced, rate_card_key } = await computeUsageCostUsd(
                sb, route.provider_code, route.model_key, tokensIn, tokensOut,
              );
              await sb.from("ai_usage_events").insert({
                tenant_id: actorTenantId, user_id: actorUserId,
                scope: "other",
                model: `${route.provider_code}/${route.model_key}`,
                tokens_in: tokensIn,
                tokens_out: tokensOut,
                cost_usd,
                meta: {
                  source: "ai_inference_router.http",
                  policy_id: route.policy_id, chain_index: route.chain_index,
                  provider_instance_id: route.provider_instance_id,
                  model_catalog_id: route.model_catalog_id,
                  latency_ms: Date.now() - started, upstream_status: r.status,
                  priced, rate_card_key,
                },
              });
              // Best-effort anomaly flagging — surface spend spikes
              if (priced && cost_usd > 1.00) {
                try {
                  await sb.from("security_events").insert({
                    tenant_id: actorTenantId, user_id: actorUserId,
                    event_type: "ai.high_cost_request", severity: "warning",
                    context: { cost_usd, model: `${route.provider_code}/${route.model_key}`, tokens_in: tokensIn, tokens_out: tokensOut },
                  } as any);
                } catch { /* best-effort */ }
              }
            } catch { /* best-effort */ }
          }
          return new Response(text, {
            status: r.status,
            headers: { ...cors, "content-type": r.headers.get("content-type") ?? "application/json",
              "x-ai-router-policy": route.policy_id ?? "", "x-ai-router-model": route.model_key,
              "x-ai-router-latency-ms": String(Date.now() - started) },
          });
        } catch (e: any) {
          if (opaque && !opaqueAccountingAttempted) {
            try { await recordOpaqueInferenceUsage(sb, opaque, { usage: null, upstreamStatus: 0, latencyMs: Date.now() - started }); }
            catch { return new Response(JSON.stringify({ error: "inference accounting unavailable" }), { status: 503, headers: cors }); }
          }
          if (e instanceof OpaqueInferenceError) {
            return new Response(JSON.stringify({ error: e.message }), { status: e.status, headers: cors });
          }
          // Use a mapping of known error shapes to safe messages. Never leak
          // provider URLs, internal model keys, or stack traces to callers.
          const safeMessage = (msg: string): string => {
            const stripped = msg.replace(/https?:\/\/[^\s]+/g, "[redacted]");
            if (stripped.includes("provider") || stripped.includes("endpoint")) return "Upstream provider temporarily unavailable";
            if (stripped.includes("rate limit") || stripped.includes("429")) return "Rate limit exceeded — please retry shortly";
            if (stripped.includes("timeout") || stripped.includes("ETIMEDOUT")) return "Request timed out — please retry";
            if (stripped.includes("auth") || stripped.includes("401") || stripped.includes("403")) return "Authentication failed";
            return "Inference request failed";
          };
          return new Response(JSON.stringify({ error: safeMessage(e?.message ?? String(e)) }), { status: 502, headers: cors });
        }
      },
    },
  },
});
