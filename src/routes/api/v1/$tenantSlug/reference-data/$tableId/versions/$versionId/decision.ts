import { createFileRoute } from "@tanstack/react-router";
import {
  decidePublicReferenceVersion,
  publicReferenceDataCors,
} from "@/lib/public-reference-data-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/reference-data/$tableId/versions/$versionId/decision")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, { status: 204, headers: publicReferenceDataCors(request, "POST") }),
      POST: async ({ request, params }) =>
        decidePublicReferenceVersion(request, params.tenantSlug, params.tableId, params.versionId),
    },
  },
});
