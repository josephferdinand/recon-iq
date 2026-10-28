import { createFileRoute } from "@tanstack/react-router";
import { archivePublicDataPrepPipeline, getPublicDataPrepPipeline, publicDataPrepCors, updatePublicDataPrepPipeline } from "@/lib/public-data-prep-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/data-prep/pipelines/$pipelineId/")({ server: { handlers: {
  OPTIONS: async ({ request }) => new Response(null, { status: 204, headers: publicDataPrepCors(request, "GET, PATCH, DELETE") }),
  GET: async ({ request, params }) => getPublicDataPrepPipeline(request, params.tenantSlug, params.pipelineId),
  PATCH: async ({ request, params }) => updatePublicDataPrepPipeline(request, params.tenantSlug, params.pipelineId),
  DELETE: async ({ request, params }) => archivePublicDataPrepPipeline(request, params.tenantSlug, params.pipelineId),
} } });
