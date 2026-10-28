import { createFileRoute } from "@tanstack/react-router";
import { listPublicReports, publicReportCors } from "@/lib/public-report-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/reports/")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => new Response(null, { status: 204, headers: publicReportCors(request, "GET") }),
      GET: async ({ request, params }) => listPublicReports(request, params.tenantSlug),
    },
  },
});
