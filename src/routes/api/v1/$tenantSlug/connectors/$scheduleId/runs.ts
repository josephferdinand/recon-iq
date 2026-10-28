import { createFileRoute } from "@tanstack/react-router";
import { queueWorkflowApiJob, workflowApiCors } from "@/lib/public-workflow-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/connectors/$scheduleId/runs")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, { status: 204, headers: workflowApiCors(request, "POST") }),
      POST: async ({ request, params }) => queueWorkflowApiJob({
        request,
        tenantSlug: params.tenantSlug,
        resourceId: params.scheduleId,
        jobKind: "connector_run",
        requiredScope: "connectors.run",
      }),
    },
  },
});
