import { createFileRoute } from "@tanstack/react-router";
import { failConnectorAgentJob } from "@/lib/connector-agent-api.server";
import { workflowApiCors } from "@/lib/public-workflow-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/connector-agent/jobs/$jobId/fail")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, { status: 204, headers: workflowApiCors(request, "POST") }),
      POST: async ({ request, params }) =>
        failConnectorAgentJob(request, params.tenantSlug, params.jobId),
    },
  },
});
