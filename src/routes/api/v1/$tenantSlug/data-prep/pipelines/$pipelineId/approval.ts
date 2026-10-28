import { createFileRoute } from "@tanstack/react-router";
import { approvePublicDataPrepPipeline, publicDataPrepCors } from "@/lib/public-data-prep-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/data-prep/pipelines/$pipelineId/approval")({ server: { handlers: {
  OPTIONS: async ({ request }) => new Response(null, { status: 204, headers: publicDataPrepCors(request, "POST") }),
  POST: async ({ request, params }) => approvePublicDataPrepPipeline(request, params.tenantSlug, params.pipelineId),
} } });
