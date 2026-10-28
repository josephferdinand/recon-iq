import { createFileRoute } from "@tanstack/react-router";
import {
  publicReferenceDataCors,
  submitPublicReferenceVersion,
} from "@/lib/public-reference-data-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/reference-data/$tableId/versions/$versionId/submit")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, { status: 204, headers: publicReferenceDataCors(request, "POST") }),
      POST: async ({ request, params }) =>
        submitPublicReferenceVersion(request, params.tenantSlug, params.tableId, params.versionId),
    },
  },
});
