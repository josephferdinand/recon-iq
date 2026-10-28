import { createFileRoute } from "@tanstack/react-router";
import { listPublicReconRunHistory, publicReconReadCors } from "@/lib/public-recon-read-authorization.server";
export const Route = createFileRoute("/api/v1/$tenantSlug/recons/$reconId/runs/history")({
  server: { handlers: {
    OPTIONS: async ({ request }) => new Response(null, { status: 204, headers: publicReconReadCors(request) }),
    GET: async ({ request, params }) => listPublicReconRunHistory(request, params.tenantSlug, params.reconId),
  } },
});
