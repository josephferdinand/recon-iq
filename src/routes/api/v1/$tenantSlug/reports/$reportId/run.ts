import { createFileRoute } from "@tanstack/react-router";
import { publicReportCors, runPublicReport } from "@/lib/public-report-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/reports/$reportId/run")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => new Response(null, { status: 204, headers: publicReportCors(request, "POST") }),
      POST: async ({ request, params }) => runPublicReport(request, params.tenantSlug, params.reportId),
    },
  },
});
