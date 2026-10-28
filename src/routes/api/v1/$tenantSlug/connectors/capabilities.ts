import { createFileRoute } from "@tanstack/react-router";
import {
  getPublicConnectorCapabilities,
  publicOperationsCors,
} from "@/lib/public-operations-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/connectors/capabilities")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, { status: 204, headers: publicOperationsCors(request, "GET") }),
      GET: async ({ request, params }) =>
        getPublicConnectorCapabilities(request, params.tenantSlug),
    },
  },
});
