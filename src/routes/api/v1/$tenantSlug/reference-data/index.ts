import { createFileRoute } from "@tanstack/react-router";
import {
  listPublicReferenceTables,
  publicReferenceDataCors,
} from "@/lib/public-reference-data-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/reference-data/")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, { status: 204, headers: publicReferenceDataCors(request, "GET") }),
      GET: async ({ request, params }) => listPublicReferenceTables(request, params.tenantSlug),
    },
  },
});
