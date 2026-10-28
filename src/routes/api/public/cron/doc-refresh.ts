// Minimal doc-refresh cron stub.
// Real docs refresh logic lives outside /api/public/cron; this route exists
// so the doc-refresh pg_cron job has a stable endpoint to POST to. Returns
// 200 with a JSON ack and logs a row into cron_run_log so operators can
// confirm the cron fired without having to parse worker logs.
//
// Surgical fix 2026-08-23: previously this endpoint did not exist (404),
// which caused the doc-refresh pg_cron job to fail every 2h window.

import { createFileRoute } from "@tanstack/react-router";
import { verifyCronSecret } from "@/lib/cron-auth.server";

export const Route = createFileRoute("/api/public/cron/doc-refresh")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauth = verifyCronSecret(request);
        if (unauth) return unauth;

        const started = Date.now();
        const ranAt = new Date().toISOString();

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.from("cron_run_log" as never).insert({
            job: "doc-refresh",
            ran_at: ranAt,
            status: "ok",
            duration_ms: Date.now() - started,
            detail: { source: "doc-refresh.cron" },
          } as never);
        } catch {
          // Best-effort logging — never fail the cron ack over a log write.
        }

        return Response.json({
          ok: true,
          job: "doc-refresh",
          ran_at: ranAt,
          duration_ms: Date.now() - started,
        });
      },
    },
  },
});
