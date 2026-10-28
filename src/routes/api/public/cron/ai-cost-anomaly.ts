import { createFileRoute } from "@tanstack/react-router";
import { verifyCronSecret } from "@/lib/cron-auth.server";

export const Route = createFileRoute("/api/public/cron/ai-cost-anomaly")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauth = verifyCronSecret(request);
        if (unauth) return unauth;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        // Per-tenant daily rollup
        const { data: rows, error } = await supabaseAdmin.rpc("ai_usage_daily_rollup", {
          _since: since,
        });

        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        type Row = {
          tenant_id: string;
          total_cost_usd: number;
          total_tokens: number;
          request_count: number;
        };

        const rollups = (rows ?? []) as Row[];

        // Compute a simple anomaly threshold: > 3x the median daily spend
        // across active tenants over the prior 7 days.
        const { data: history } = await supabaseAdmin.rpc("ai_usage_tenant_history", {
          _days: 7,
        });

        const sums = ((history ?? []) as Row[])
          .map((r) => Number(r.total_cost_usd ?? 0))
          .filter((n) => Number.isFinite(n) && n > 0)
          .sort((a, b) => a - b);
        const median = sums.length === 0
          ? 0
          : sums[Math.floor(sums.length / 2)];
        const threshold = Math.max(50, median * 3);

        const anomalies = rollups.filter((r) => Number(r.total_cost_usd ?? 0) > threshold);

        let flagged = 0;
        for (const a of anomalies) {
          const { error: evErr } = await supabaseAdmin.from("security_events").insert({
            tenant_id: a.tenant_id,
            event_type: "ai.anomalous_daily_spend",
            severity: "warning",
            context: {
              total_cost_usd: a.total_cost_usd,
              request_count: a.request_count,
              total_tokens: a.total_tokens,
              threshold_usd: threshold,
              window: "24h",
            },
          } as any);
          if (!evErr) flagged++;
        }

        return Response.json({
          ok: true,
          tenants_scanned: rollups.length,
          anomalies: anomalies.length,
          flagged,
          threshold_usd: threshold,
        });
      },
    },
  },
});
