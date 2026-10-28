// Auto-RCA hint producer (G-31). Called by pg_cron every 15 minutes.
// Scans recent security_events / incident_events for correlated signals and
// writes low-confidence hints into `platform_incident_rca_hints`.
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronSecret } from "@/lib/cron-auth.server";

export const Route = createFileRoute("/api/public/cron/gap-rca-producer")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauth = verifyCronSecret(request);
        if (unauth) return unauth;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const since = new Date(Date.now() - 15 * 60_000).toISOString();
        const { data: evs } = await supabaseAdmin
          .from("security_events" as never)
          .select("event_type,severity,context,created_at")
          .gte("created_at", since)
          .limit(200);
        const rows = evs ?? [];
        const bySeverity: Record<string, number> = {};
        for (const e of rows as any[]) bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
        const hints: any[] = [];
        if ((bySeverity.critical ?? 0) >= 3) {
          hints.push({ hint: `Critical security events spike (${bySeverity.critical}) in last 15m`, confidence: 82, source: "gap-rca-producer", evidence: { bySeverity } });
        }
        if ((bySeverity.warning ?? 0) >= 20) {
          hints.push({ hint: `Elevated warning volume (${bySeverity.warning}) suggests rate-limit or auth pressure`, confidence: 61, source: "gap-rca-producer", evidence: { bySeverity } });
        }
        for (const h of hints) {
          await supabaseAdmin.from("platform_incident_rca_hints" as never).insert(h);
        }
        return Response.json({ ok: true, sampled: rows.length, produced: hints.length });
      },
    },
  },
});
