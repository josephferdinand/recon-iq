// Continuous security monitoring evaluator — runs every 5 min via pg_cron.
// Triggers the SECURITY DEFINER `evaluate_security_alerts()` RPC which scans
// security_events for matching patterns, opens incidents, and notifies tenant admins.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

async function run() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await (sb as any).rpc("evaluate_security_alerts");
  if (error) throw error;
  const rows = (data ?? []) as Array<{ rule_id: string; tenant_id: string | null; event_count: number; fired: boolean }>;
  return { evaluated: rows.length, fired: rows.filter((r) => r.fired).length, rows };
}

export const Route = createFileRoute("/api/public/cron/security-alert-eval")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronSecret } = await import("@/lib/cron-auth.server");
        const unauth = verifyCronSecret(request);
        if (unauth) return unauth;
        try {
          const result = await run();
          return Response.json({ ok: true, ...result });
        } catch (e) {
          console.error("[security-alert-eval] failed", e);
          return Response.json({ ok: false, error: "internal_error" }, { status: 500 });
        }
      },
    },
  },
});
