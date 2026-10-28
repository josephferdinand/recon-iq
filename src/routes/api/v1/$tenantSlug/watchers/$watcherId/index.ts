import { createFileRoute } from "@tanstack/react-router";
import { publicWatcherCors, updatePublicWatcher } from "@/lib/public-watcher-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/watchers/$watcherId/")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, { status: 204, headers: publicWatcherCors(request, "PATCH") }),
      PATCH: async ({ request, params }) =>
        updatePublicWatcher(request, params.tenantSlug, params.watcherId),
    },
  },
});
