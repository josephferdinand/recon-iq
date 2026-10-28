import { createFileRoute } from "@tanstack/react-router";
import { getPublicStatusSnapshot } from "@/lib/status.functions";
import { getPublicCorsOrigin as getCorsOrigin } from "@/lib/public-cors";

export const Route = createFileRoute("/api/public/status.json")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => {
        const origin = getCorsOrigin(request.headers.get("origin"));
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-methods": "GET, OPTIONS",
            "access-control-allow-headers": "content-type",
            ...(origin ? { "access-control-allow-origin": origin } : {}),
          },
        });
      },
      GET: async ({ request }) => {
        const snap = await getPublicStatusSnapshot();
        const origin = getCorsOrigin(request.headers.get("origin"));
        return new Response(JSON.stringify(snap, null, 2), {
          status: snap.data_status === "unavailable" ? 503 : 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": snap.data_status === "complete" ? "public, max-age=30, s-maxage=30" : "no-store",
            ...(origin ? { "access-control-allow-origin": origin } : {}),
          },
        });
      },
    },
  },
});
