import { createFileRoute } from "@tanstack/react-router";
import {
  createPublicEnvironmentChange,
  listPublicEnvironmentChanges,
  publicEnvironmentChangeCors,
} from "@/lib/public-environment-change-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/environment-changes/")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, {
          status: 204,
          headers: publicEnvironmentChangeCors(request, "GET, POST"),
        }),
      GET: async ({ request, params }) => listPublicEnvironmentChanges(request, params.tenantSlug),
      POST: async ({ request, params }) =>
        createPublicEnvironmentChange(request, params.tenantSlug),
    },
  },
});
