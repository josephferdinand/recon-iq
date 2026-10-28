/**
 * GET /api/regulatory/installs?tenant_id=...
 *
 * Authenticated list of regulatory pack installs for a tenant. The caller
 * must pass a Supabase bearer token in `Authorization: Bearer <jwt>`. RLS
 * on `regulatory_pack_installs` restricts results to tenants the user
 * belongs to.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { safeSupabaseError } from "@/lib/safe-error.server";

const PATH = "/api/regulatory/installs";

function unauthorized(msg = "Unauthorized") {
  return new Response(JSON.stringify({ error: msg }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/regulatory/installs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        // LL-066 + LL-073 — strict JWT-shape match so malformed Bearer tokens
        // return 401 (not 500 from a missing env downstream).
        if (!/^bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.test(auth)) {
          return unauthorized();
        }

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return new Response(JSON.stringify({ error: "server_misconfigured" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }

        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenant_id");
        if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
          return new Response(JSON.stringify({ error: "tenant_id required" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const supabase = createClient<Database>(
          SUPABASE_URL,
          SUPABASE_PUBLISHABLE_KEY,
          {
            auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
            global: { headers: { Authorization: auth } },
          },
        );

        const { data, error } = await supabase
          .from("regulatory_pack_installs")
          .select(
            "id, tenant_id, pack_id, installed_version, installed_at, status, error_message, generated_process_count, tenant_root_process_id, completed_at, materialized_artifacts, pack:regulatory_template_packs(pack_code, code, title, regulation, jurisdiction)",
          )
          .eq("tenant_id", tenantId)
          .order("installed_at", { ascending: false });

        if (error) {
          const safe = safeSupabaseError(error, { path: PATH, tenantId });
          return new Response(JSON.stringify({ error: safe.body.error }), {
            status: 403,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ installs: data ?? [] }, null, 2), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
