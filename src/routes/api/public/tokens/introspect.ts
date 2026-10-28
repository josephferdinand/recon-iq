import { createFileRoute } from "@tanstack/react-router";
import { introspectWorkflowToken } from "@/lib/public-workflow-api.server";

export const Route = createFileRoute("/api/public/tokens/introspect")({
  server: {
    handlers: {
      POST: async ({ request }) => introspectWorkflowToken(request),
    },
  },
});
