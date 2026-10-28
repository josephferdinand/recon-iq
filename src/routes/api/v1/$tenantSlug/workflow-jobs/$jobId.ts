import { createFileRoute } from "@tanstack/react-router";
import { getWorkflowApiJob, workflowApiCors } from "@/lib/public-workflow-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/workflow-jobs/$jobId")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => new Response(null, { status: 204, headers: workflowApiCors(request, "GET") }),
      GET: async ({ request, params }) => getWorkflowApiJob(request, params.tenantSlug, params.jobId),
    },
  },
});
