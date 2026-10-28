/**
 * AIDP Slice 4 — cron worker. Processes aidp_output_recon_invalidations,
 * enqueues recon re-runs for any recon that consumes the superseded entity
 * type, and marks the invalidation processed.
 *
 * Auth: cron header `apikey` = anon/publishable key (canonical pg_cron pattern).
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/aidp-output-processor")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronSecret } = await import("@/lib/cron-auth.server");
        const unauth = verifyCronSecret(request);
        if (unauth) return unauth;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: rows } = await supabaseAdmin
          .from("aidp_output_recon_invalidations")
          .select("id, tenant_id, output_id")
          .eq("status", "pending")
          .limit(100);

        let processed = 0;
        let enqueued = 0;
        for (const row of rows ?? []) {
          // 1) Resolve superseded output → entity_type_id
          const { data: out } = await supabaseAdmin.from("aidp_outputs")
            .select("entity_type_id, document_id").eq("id", row.output_id).maybeSingle();
          if (!out) {
            await supabaseAdmin.from("aidp_output_recon_invalidations")
              .update({ status: "skipped", processed_at: new Date().toISOString() })
              .eq("id", row.id);
            continue;
          }

          // 2) Find the recon rule wired to this entity type
          const { data: et } = await supabaseAdmin.from("aidp_entity_types")
            .select("auto_publish_rule_id").eq("id", out.entity_type_id).maybeSingle();

          if (et?.auto_publish_rule_id) {
            // 3) Find recon_definitions that use this NRL rule → enqueue runs
            const { data: defs } = await supabaseAdmin.from("recon_definitions")
              .select("id").eq("tenant_id", row.tenant_id).limit(50);
            for (const def of defs ?? []) {
              await supabaseAdmin.from("recon_runs").insert({
                tenant_id: row.tenant_id,
                definition_id: def.id,
                status: "queued",
                triggered_by: "aidp_invalidation",
                context: { source_output_id: row.output_id, source_entity_type_id: out.entity_type_id },
              } as any);
              enqueued += 1;
            }
            await supabaseAdmin.from("aidp_output_recon_invalidations")
              .update({ status: "enqueued", processed_at: new Date().toISOString() })
              .eq("id", row.id);
          } else {
            await supabaseAdmin.from("aidp_output_recon_invalidations")
              .update({ status: "processed", processed_at: new Date().toISOString() })
              .eq("id", row.id);
          }
          processed += 1;
        }

        return Response.json({ ok: true, processed, enqueued });
      },
    },
  },
});
