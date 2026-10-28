/**
 * GET /api/public/regulatory/packs
 *
 * Anonymous read of all `published` regulatory template packs. Returns only
 * the catalogue metadata that is safe to expose without auth — no install
 * counts per tenant, no field dictionary internals. Backed by the
 * `regpacks public read published` RLS policy (TO anon) on
 * `public.regulatory_template_packs`.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { safeErrorResponse, safeSupabaseError } from "@/lib/safe-error.server";
import { getPublicCorsOrigin as getCorsOrigin } from "@/lib/public-cors";

const PATH = "/api/public/regulatory/packs";

export const Route = createFileRoute("/api/public/regulatory/packs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const supabase = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
        );
        const { data, error } = await supabase
          .from("regulatory_template_packs")
          .select(
            "id, code, pack_code, title, jurisdiction, regulation, version, summary, tags, status, install_runbook_url, required_data_inputs",
          )
          .eq("status", "published")
          .order("regulation", { ascending: true });
        const origin = getCorsOrigin(request.headers.get("origin"));
        if (error) {
          return safeErrorResponse(safeSupabaseError(error, { path: PATH }));
        }
        return new Response(JSON.stringify({ packs: data ?? [] }, null, 2), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, max-age=60, s-maxage=60",
            ...(origin ? { "access-control-allow-origin": origin } : {}),
          },
        });
      },
      OPTIONS: async ({ request }) => {
        const origin = getCorsOrigin(request.headers.get("origin"));
        const headers: Record<string, string> = {
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-headers": "content-type",
        };
        if (origin) headers["access-control-allow-origin"] = origin;
        return new Response(null, { status: 204, headers });
      },
    },
  },
});
