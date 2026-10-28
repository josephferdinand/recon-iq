import { createFileRoute } from "@tanstack/react-router";
import { getPublicCorsOrigin as getCorsOrigin } from "@/lib/public-cors";

function corsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin = getCorsOrigin(requestOrigin);
  return origin ? { "access-control-allow-origin": origin } : {};
}

export const Route = createFileRoute("/api/public/mkt-site-logos")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => {
        const origin = request.headers.get("origin");
        const co = getCorsOrigin(origin);
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-methods": "GET, OPTIONS",
            "access-control-allow-headers": "content-type",
            ...(co ? { "access-control-allow-origin": co } : {}),
            "cache-control": "public, max-age=60, s-maxage=300",
          },
        });
      },
      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("mkt_site_logos")
          .select("id,name,category,logo_url,website_url,display_order")
          .eq("published", true)
          .order("display_order", { ascending: true })
          .order("name", { ascending: true });
        const origin = getCorsOrigin(request.headers.get("origin"));
        const cors: Record<string, string> = origin ? { "access-control-allow-origin": origin } : {};
        if (error) {
          return new Response(JSON.stringify({ logos: [] }), {
            status: 200,
            headers: { "content-type": "application/json", ...cors },
          });
        }
        return new Response(JSON.stringify({ logos: data ?? [] }), {
          status: 200,
          headers: { "content-type": "application/json", ...cors },
        });
      },
    },
  },
});
