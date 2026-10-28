import { createFileRoute } from "@tanstack/react-router";
import { actionPublicBreak, publicBreakCors } from "@/lib/public-break-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/recons/$reconId/breaks/$breakId/actions")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => new Response(null, { status: 204, headers: publicBreakCors(request, "POST") }),
      POST: async ({ request, params }) => actionPublicBreak(request, params.tenantSlug, params.reconId, params.breakId),
    },
  },
});
