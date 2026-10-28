import { createFileRoute } from "@tanstack/react-router";
import { getPublicCorsOrigin as getCorsOrigin } from "@/lib/public-cors";

function corsHeaders(origin: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (origin) {
    out["access-control-allow-origin"] = origin;
    out["access-control-allow-credentials"] = "true";
    out["vary"] = "Origin";
  }
  return out;
}

export const Route = createFileRoute("/api/public/tenants/$id/health")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const origin = getCorsOrigin(request.headers.get("origin"));
        return new Response(null, {
          status: 204,
          headers: {
            ...corsHeaders(origin),
            "access-control-allow-methods": "GET, OPTIONS",
            "access-control-allow-headers": "authorization, content-type, apikey",
            "access-control-max-age": "86400",
          },
        });
      },
      GET: async ({ params, request }) => {
        const origin = getCorsOrigin(request.headers.get("origin"));

        // Validate Bearer JWT and tenant membership using the publishable key.
        // The function `get_latest_tenant_health(_tenant_id)` is
        // security invoker + reads via RLS, so unauthorized callers see null.
        const { createClient } = await import("@supabase/supabase-js");
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return Response.json({ error: "server_misconfigured" }, { status: 500, headers: corsHeaders(origin) });
        }
        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return Response.json({ error: "unauthorized" }, { status: 401, headers: corsHeaders(origin) });
        }
        const token = authHeader.replace("Bearer ", "");
        const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: latest, error: latestErr } = await supabase
          .rpc("get_latest_tenant_health", { _tenant_id: params.id })
          .maybeSingle();
        if (latestErr) {
          return Response.json({ error: latestErr.message }, { status: 400, headers: corsHeaders(origin) });
        }
        if (!latest) {
          return Response.json(
            { tenant_id: params.id, has_snapshot: false },
            { status: 200, headers: corsHeaders(origin) },
          );
        }

        const daysHeader = request.headers.get("x-trend-days");
        const days = daysHeader ? Math.max(7, Math.min(90, parseInt(daysHeader, 10) || 30)) : 30;
        const { data: trend, error: trendErr } = await supabase.rpc("get_tenant_health_trend", {
          _tenant_id: params.id,
          _days: days,
        });
        if (trendErr) {
          return Response.json({ error: trendErr.message }, { status: 400, headers: corsHeaders(origin) });
        }

        return Response.json(
          {
            tenant_id: params.id,
            has_snapshot: true,
            snapshot: latest,
            trend: (trend ?? []).map((r: any) => ({
              day: r.day,
              overall_score: Number(r.overall_score ?? 0),
            })),
            generated_at: new Date().toISOString(),
          },
          {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "private, no-store",
              ...corsHeaders(origin),
            },
          },
        );
      },
    },
  },
});
