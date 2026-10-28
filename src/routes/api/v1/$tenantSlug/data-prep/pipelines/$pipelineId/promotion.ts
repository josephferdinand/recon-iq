import { createFileRoute } from "@tanstack/react-router";
import { publicDataPrepCors, requestPublicDataPrepPromotion } from "@/lib/public-data-prep-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/data-prep/pipelines/$pipelineId/promotion")({ server: { handlers: {
  OPTIONS: async ({ request }) => new Response(null, { status: 204, headers: publicDataPrepCors(request, "POST") }),
  POST: async ({ request, params }) => requestPublicDataPrepPromotion(request, params.tenantSlug, params.pipelineId),
} } });
