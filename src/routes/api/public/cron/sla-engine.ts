// SLA Engine cron — evaluates break SLA timers, fires escalation actions,
// and writes break_sla_events. Called every minute by pg_cron.
//
// Step 2 of Exception Management v2 — pairs the existing
// `sla_evaluate_breaches()` PL/pgSQL function with a transport layer that
// can notify channels and update timers.
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronSecret } from "@/lib/cron-auth.server";
import { safeErrorResponse, safeSupabaseError } from "@/lib/safe-error.server";

const PATH = "/api/public/cron/sla-engine";

export const Route = createFileRoute("/api/public/cron/sla-engine")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauth = verifyCronSecret(request);
        if (unauth) return unauth;

        const started = Date.now();
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        // 1) Ask the database which exceptions just breached or escalated.
        const { data: actions, error } = await supabaseAdmin.rpc(
          "sla_evaluate_breaches",
        );
        if (error) {
          return safeErrorResponse(safeSupabaseError(error, { path: PATH }));
        }
        const rows = (actions ?? []) as Array<{
          action: string;
          exception_id: string;
          level: number;
        }>;

        // 2) Persist events + fan out side effects.
        let notified = 0;
        let breached = 0;
        for (const row of rows) {
          if (row.action === "breached") breached++;
          if (row.action === "escalated") notified++;

          await supabaseAdmin.from("break_sla_events").insert({
            exception_id: row.exception_id,
            level: row.level,
            event_type: row.action,
            payload: { source: "sla-engine.cron" },
          } as never);
        }

        return Response.json({
          ok: true,
          evaluated: rows.length,
          breached,
          escalations_fired: notified,
          duration_ms: Date.now() - started,
        });
      },
    },
  },
});
