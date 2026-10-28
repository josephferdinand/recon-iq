import { createFileRoute } from "@tanstack/react-router";
import { verifyCronSecret } from "@/lib/cron-auth.server";
import type { SupabaseClient } from "@supabase/supabase-js";

// Nightly purge of recon_runs (and cascading matches/exceptions) older than each tenant's
// run_retention_days setting. Also evaluates all enabled data watchers.
export const Route = createFileRoute("/api/public/cron/retention-and-watchers")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const _unauth = verifyCronSecret(request);
        if (_unauth) return _unauth;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { evaluateWatcherById } = await import("@/lib/watcher-evaluator.server");
        const { data: purgedLegacy, error: pErrLegacy } = await supabaseAdmin.rpc(
          "purge_expired_recon_runs",
        );
        const { data: purgedAll, error: pErrAll } = await (
          supabaseAdmin as unknown as SupabaseClient
        ).rpc("purge_expired_data");

        // D4: emit one security_events row per (table_name, tenant_id) bucket that
        //      actually deleted rows so SOC 2 CC7.2 reviewers can attest the purge
        //      ran and how much it removed.
        if (Array.isArray(purgedAll)) {
          const events = (
            purgedAll as Array<{ t_name: string; t_tenant: string | null; t_deleted: number }>
          )
            .filter((r) => (r?.t_deleted ?? 0) > 0)
            .map((r) => ({
              tenant_id: r.t_tenant,
              event_type: "retention.purge",
              severity: "info",
              context: {
                table_name: r.t_name,
                deleted_count: Number(r.t_deleted),
                purged_at: new Date().toISOString(),
              },
            }));
          if (events.length > 0) {
            await supabaseAdmin.from("security_events" as any).insert(events as any);
          }
        }

        const { data: watchers } = await supabaseAdmin
          .from("data_watchers")
          .select("id, tenant_id")
          .eq("enabled", true);

        let evaluated = 0,
          alerted = 0;
        for (const w of watchers ?? []) {
          try {
            const result = await evaluateWatcherById({
              admin: supabaseAdmin,
              tenantId: w.tenant_id,
              watcherId: w.id,
              actorUserId: null,
              trigger: "schedule",
            });
            if (result.state === "alert") alerted++;
            evaluated++;
          } catch {
            /* continue */
          }
        }
        return Response.json({
          purged_legacy_recon_runs: purgedLegacy ?? 0,
          purged_all: purgedAll ?? [],
          purge_error: pErrLegacy?.message ?? pErrAll?.message ?? null,
          watchers_evaluated: evaluated,
          watchers_alerted: alerted,
        });
      },
    },
  },
});
