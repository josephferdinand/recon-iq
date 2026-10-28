import { createFileRoute } from "@tanstack/react-router";
import { createPublicDataPrepPipeline, listPublicDataPrepPipelines, publicDataPrepCors } from "@/lib/public-data-prep-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/data-prep/pipelines/")({ server: { handlers: {
  OPTIONS: async ({ request }) => new Response(null, { status: 204, headers: publicDataPrepCors(request, "GET, POST") }),
  GET: async ({ request, params }) => listPublicDataPrepPipelines(request, params.tenantSlug),
  POST: async ({ request, params }) => createPublicDataPrepPipeline(request, params.tenantSlug),
} } });
