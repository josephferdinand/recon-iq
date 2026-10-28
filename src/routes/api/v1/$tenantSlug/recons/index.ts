import { createFileRoute } from "@tanstack/react-router";
import {
  listPublicReconciliations,
  publicOperationsCors,
} from "@/lib/public-operations-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/recons/")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, { status: 204, headers: publicOperationsCors(request, "GET") }),
      GET: async ({ request, params }) => listPublicReconciliations(request, params.tenantSlug),
    },
  },
});
