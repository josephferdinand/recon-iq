import { createFileRoute } from "@tanstack/react-router";
import {
  createPublicWatcher,
  listPublicWatchers,
  publicWatcherCors,
} from "@/lib/public-watcher-api.server";

export const Route = createFileRoute("/api/v1/$tenantSlug/watchers/")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, { status: 204, headers: publicWatcherCors(request, "GET, POST") }),
      GET: async ({ request, params }) => listPublicWatchers(request, params.tenantSlug),
      POST: async ({ request, params }) => createPublicWatcher(request, params.tenantSlug),
    },
  },
});
