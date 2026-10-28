// Daily verification cron — compares the latest audit_anchors DB row's
// row_hash_hex against the external R2 witness object's customMetadata.rowHash.
// Scheduled at 03:30 UTC daily (writer runs at 03:00).
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronSecret } from "@/lib/cron-auth.server";
import { getR2Binding } from "@/lib/r2-bindings.server";
import { verifyLatestAnchor } from "@/lib/audit-anchor.functions";

export const Route = createFileRoute("/api/public/cron/audit-anchor-verify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauth = verifyCronSecret(request);
        if (unauth) return unauth;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const result = await verifyLatestAnchor(supabaseAdmin as never, getR2Binding("AUDIT_ANCHORS"));
        return Response.json(result, { status: 200 });
      },
    },
  },
});
