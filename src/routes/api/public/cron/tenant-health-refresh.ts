import { createFileRoute } from "@tanstack/react-router";
import { verifyCronSecret } from "@/lib/cron-auth.server";

export const Route = createFileRoute("/api/public/cron/tenant-health-refresh")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauth = verifyCronSecret(request);
        if (unauth) return unauth;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: tenants, error: tenantsErr } = await supabaseAdmin
          .from("tenants")
          .select("id")
          .is("deleted_at", null);
        if (tenantsErr) {
          return Response.json({ ok: false, error: tenantsErr.message }, { status: 500 });
        }

        let scored = 0;
        let forecast = 0;
        const errors: Array<{ tenant_id: string; step: string; error: string }> = [];

        for (const t of (tenants ?? []) as Array<{ id: string }>) {
          try {
            const { error: scoreErr } = await supabaseAdmin.rpc("compute_tenant_health_score", {
              _tenant_id: t.id,
              _window_days: 30,
            });
            if (scoreErr) throw new Error(`score: ${scoreErr.message}`);
            scored++;

            const { error: forecastErr } = await supabaseAdmin.rpc("predict_next_exception_volume", {
              _tenant_id: t.id,
              _horizon_days: 7,
              _as_of: new Date().toISOString().slice(0, 10),
            });
            if (forecastErr) throw new Error(`forecast: ${forecastErr.message}`);
            forecast++;
          } catch (e) {
            errors.push({ tenant_id: t.id, step: "refresh", error: (e as Error).message });
          }
        }

        return Response.json({
          ok: errors.length === 0,
          tenants: (tenants ?? []).length,
          scored,
          forecast,
          errors,
          ran_at: new Date().toISOString(),
        });
      },
    },
  },
});