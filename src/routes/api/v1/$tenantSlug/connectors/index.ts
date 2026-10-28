import { createFileRoute } from "@tanstack/react-router";
import {
  listPublicConnectorSchedules,
  publicOperationsCors,
} from "@/lib/public-operations-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/connectors/")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, { status: 204, headers: publicOperationsCors(request, "GET") }),
      GET: async ({ request, params }) => listPublicConnectorSchedules(request, params.tenantSlug),
    },
  },
});
