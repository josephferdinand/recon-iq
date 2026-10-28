import { createFileRoute } from "@tanstack/react-router";
import { disablePublicWatcher, publicWatcherCors } from "@/lib/public-watcher-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/watchers/$watcherId/disable")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, { status: 204, headers: publicWatcherCors(request, "POST") }),
      POST: async ({ request, params }) =>
        disablePublicWatcher(request, params.tenantSlug, params.watcherId),
    },
  },
});
