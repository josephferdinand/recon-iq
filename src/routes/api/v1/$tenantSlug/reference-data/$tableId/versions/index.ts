import { createFileRoute } from "@tanstack/react-router";
import {
  listPublicReferenceVersions,
  publicReferenceDataCors,
  stagePublicReferenceVersion,
} from "@/lib/public-reference-data-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/reference-data/$tableId/versions/")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, { status: 204, headers: publicReferenceDataCors(request, "GET, POST") }),
      GET: async ({ request, params }) =>
        listPublicReferenceVersions(request, params.tenantSlug, params.tableId),
      POST: async ({ request, params }) =>
        stagePublicReferenceVersion(request, params.tenantSlug, params.tableId),
    },
  },
});
