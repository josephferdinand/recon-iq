import { createFileRoute } from "@tanstack/react-router";
import { runAuditAnchorWrite } from "@/lib/audit-anchor.functions";
import { verifyCronSecret } from "@/lib/cron-auth.server";

export const Route = createFileRoute("/api/public/cron/audit-anchor-write")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verifyCronSecret(request);
        if (unauthorized) return unauthorized;

        const result = await runAuditAnchorWrite();
        return Response.json(result, { status: 200 });
      },
    },
  },
});
