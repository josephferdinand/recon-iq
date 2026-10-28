import { createFileRoute } from "@tanstack/react-router";
import {
  exportPublicReferenceVersion,
  publicReferenceDataCors,
} from "@/lib/public-reference-data-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/reference-data/$tableId/versions/$versionId/export")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, { status: 204, headers: publicReferenceDataCors(request, "GET") }),
      GET: async ({ request, params }) =>
        exportPublicReferenceVersion(request, params.tenantSlug, params.tableId, params.versionId),
    },
  },
});
