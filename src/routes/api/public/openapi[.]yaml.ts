import { createFileRoute } from "@tanstack/react-router";
import spec from "../../../../docs/openapi/fvi-openapi.yaml?raw";
import { getPublicCorsOrigin as getCorsOrigin } from "@/lib/public-cors";

export const Route = createFileRoute("/api/public/openapi.yaml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = getCorsOrigin(request.headers.get("origin"));
        return new Response(spec, {
          status: 200,
          headers: {
            "content-type": "application/yaml; charset=utf-8",
            "cache-control": "public, max-age=300, s-maxage=300",
            ...(origin ? { "access-control-allow-origin": origin } : {}),
          },
        });
      },
    },
  },
});
