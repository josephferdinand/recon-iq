import { createFileRoute } from "@tanstack/react-router";
import { listPublicWatcherEvents, publicWatcherCors } from "@/lib/public-watcher-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/watchers/$watcherId/events")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, { status: 204, headers: publicWatcherCors(request, "GET") }),
      GET: async ({ request, params }) =>
        listPublicWatcherEvents(request, params.tenantSlug, params.watcherId),
    },
  },
});
