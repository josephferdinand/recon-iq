import { createFileRoute } from "@tanstack/react-router";
import { getPublicBreak, publicBreakCors } from "@/lib/public-break-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/recons/$reconId/breaks/$breakId")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => new Response(null, { status: 204, headers: publicBreakCors(request, "GET") }),
      GET: async ({ request, params }) => getPublicBreak(request, params.tenantSlug, params.reconId, params.breakId),
    },
  },
});
