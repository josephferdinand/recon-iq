import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getPublicCorsOrigin as getCorsOrigin } from "@/lib/public-cors";

const Body = z.object({
  event_type: z.enum([
    "auth.failed_login",
    "auth.success_login",
    "auth.logout",
    "auth.password_reset_requested",
    "auth.password_reset_completed",
    "auth.password_reset_failed",
    "auth.mfa_failed",
    "auth.mfa_enroll_failed",
    "auth.signup_failed",
    "auth.signup_success",
  ]),
  email: z.string().email().max(254).optional(),
  user_id: z.string().uuid().optional(),
  context: z.record(z.string(), z.any()).optional(),
});

function clientIp(req: Request): string | null {
  const h = req.headers;
  return (
    h.get("cf-connecting-ip") ||
    h.get("x-real-ip") ||
    (h.get("x-forwarded-for") || "").split(",")[0]?.trim() ||
    null
  );
}

function corsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin = getCorsOrigin(requestOrigin);
  return origin ? { "access-control-allow-origin": origin } : {};
}

export const Route = createFileRoute("/api/public/security-event")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const headers: Record<string, string> = {
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "86400",
          ...corsHeaders(request.headers.get("origin")),
        };
        return new Response(null, { status: 204, headers });
      },
      POST: async ({ request }) => {
        const cors = corsHeaders(request.headers.get("origin"));
        let payload: any;
        try {
          payload = Body.parse(await request.json());
        } catch (e: any) {
          return new Response(JSON.stringify({ error: "invalid" }), { status: 400, headers: cors });
        }
        const ip = clientIp(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Per-IP rate limit (10/min) to prevent log flooding.
        const key = `pub.sec_evt:${ip ?? "anon"}`;
        const { data: rl } = await supabaseAdmin.rpc("rate_limit_hit", {
          _key: key, _window_seconds: 60, _limit: 20,
        });
        const allowed = Array.isArray(rl) ? rl[0]?.allowed : (rl as any)?.allowed;
        if (allowed === false) {
          return new Response(JSON.stringify({ ok: true }), { status: 202, headers: cors });
        }

        // Severity: success/logout = info, anything failed/reset = warning.
        const successLike = new Set([
          "auth.success_login",
          "auth.logout",
          "auth.signup_success",
          "auth.password_reset_requested",
          "auth.password_reset_completed",
        ]);
        const severity = successLike.has(payload.event_type) ? "info" : "warning";

        await supabaseAdmin.from("security_events").insert({
          tenant_id: null,
          user_id: payload.user_id ?? null,
          ip,
          event_type: payload.event_type,
          severity,
          context: { email: payload.email ?? null, ...(payload.context ?? {}) },
        } as any);
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
      },
    },
  },
});
