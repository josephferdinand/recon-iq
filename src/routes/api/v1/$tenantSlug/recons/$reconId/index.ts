import { createFileRoute } from "@tanstack/react-router";
import {
  getPublicReconciliation,
  publicOperationsCors,
} from "@/lib/public-operations-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/recons/$reconId/")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, { status: 204, headers: publicOperationsCors(request, "GET") }),
      GET: async ({ request, params }) =>
        getPublicReconciliation(request, params.tenantSlug, params.reconId),
    },
  },
});
