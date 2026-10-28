import { createFileRoute } from "@tanstack/react-router";
import {
  decidePublicEnvironmentChange,
  publicEnvironmentChangeCors,
} from "@/lib/public-environment-change-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/environment-changes/$requestId/decision")(
  {
    server: {
      handlers: {
        OPTIONS: async ({ request }) =>
          new Response(null, {
            status: 204,
            headers: publicEnvironmentChangeCors(request, "POST"),
          }),
        POST: async ({ request, params }) =>
          decidePublicEnvironmentChange(request, params.tenantSlug, params.requestId),
      },
    },
  },
);
