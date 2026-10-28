import { createFileRoute } from "@tanstack/react-router";
import { listPublicBreaks, publicBreakCors } from "@/lib/public-break-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/recons/$reconId/breaks/")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => new Response(null, { status: 204, headers: publicBreakCors(request, "GET") }),
      GET: async ({ request, params }) => listPublicBreaks(request, params.tenantSlug, params.reconId),
    },
  },
});
