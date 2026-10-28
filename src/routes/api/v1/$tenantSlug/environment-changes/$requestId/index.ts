import { createFileRoute } from "@tanstack/react-router";
import {
  getPublicEnvironmentChange,
  publicEnvironmentChangeCors,
} from "@/lib/public-environment-change-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/environment-changes/$requestId/")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, {
          status: 204,
          headers: publicEnvironmentChangeCors(request, "GET"),
        }),
      GET: async ({ request, params }) =>
        getPublicEnvironmentChange(request, params.tenantSlug, params.requestId),
    },
  },
});
