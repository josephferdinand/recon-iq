/**
 * POST /api/regulatory/install
 * Body: { tenant_id: string, pack_code: string, force_reinstall?: boolean }
 * Headers: Authorization: Bearer <supabase_jwt>
 *
 * Authenticated install entry point for external/API callers. Mirrors the
 * RBAC, idempotency and audit behaviours of `installRegulatoryPack` server
 * function used by the in-app UI. Returns `{ installId, reused }`.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

const Body = z.object({
  tenant_id: z.string().uuid(),
  pack_code: z.string().min(1).regex(/^[A-Za-z0-9_.-]+$/),
  force_reinstall: z.boolean().optional(),
});

const ACTIVE = ["pending", "installing", "materializing", "ready"];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/regulatory/install")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        // LL-066 + LL-073 — strict JWT-shape match so malformed Bearer tokens
        // return 401 (not 500 from a missing env var downstream).
        if (!/^bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.test(auth)) {
          return json(401, { error: "Unauthorized" });
        }

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return json(500, { error: "server_misconfigured" });
        }

        let parsed;
        try {
          parsed = Body.parse(await request.json());
        } catch (e: any) {
          return json(400, { error: e?.message ?? "Invalid body" });
        }

        // RLS-scoped client acting as the caller.
        const supabase = createClient<Database>(
          SUPABASE_URL,
          SUPABASE_PUBLISHABLE_KEY,
          {
            auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
            global: { headers: { Authorization: auth } },
          },
        );

        const { data: userRes, error: uErr } = await supabase.auth.getUser();
        if (uErr || !userRes?.user) return json(401, { error: "Invalid token" });
        const userId = userRes.user.id;

        // RBAC: platform admin or tenant_admin.
        const { data: isPlatform } = await supabase.rpc("is_platform_admin", { _user_id: userId });
        if (!isPlatform) {
          const { data: hasRole } = await supabase.rpc("has_tenant_role", {
            _user_id: userId,
            _tenant_id: parsed.tenant_id,
            _role: "tenant_admin",
          });
          if (!hasRole) return json(403, { error: "Forbidden: tenant_admin required" });
        }

        // Resolve pack by pack_code (preferred) or legacy code.
        let { data: pack } = await supabase
          .from("regulatory_template_packs")
          .select("id, pack_code, code, version, status")
          .eq("pack_code", parsed.pack_code)
          .eq("status", "published")
          .maybeSingle();
        if (!pack) {
          const fb = await supabase
            .from("regulatory_template_packs")
            .select("id, pack_code, code, version, status")
            .eq("code", parsed.pack_code)
            .eq("status", "published")
            .maybeSingle();
          pack = fb.data as any;
        }
        if (!pack) return json(404, { error: `Pack not found or not published: ${parsed.pack_code}` });

        if (!parsed.force_reinstall) {
          const { data: existing } = await supabase
            .from("regulatory_pack_installs")
            .select("id, status")
            .eq("tenant_id", parsed.tenant_id)
            .eq("pack_id", pack.id)
            .in("status", ACTIVE)
            .order("installed_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (existing?.id) return json(200, { installId: existing.id, reused: true });
        }

        const { data: row, error: insErr } = await supabase
          .from("regulatory_pack_installs")
          .insert({
            tenant_id: parsed.tenant_id,
            pack_id: pack.id,
            installed_by: userId,
            installed_version: pack.version,
            status: "installing",
          })
          .select("id")
          .single();
        if (insErr) return json(400, { error: insErr.message });

        // Fire-and-forget materialization worker.
        try {
          const origin =
            process.env.PUBLIC_BASE_URL ?? process.env.VITE_PUBLIC_BASE_URL ?? new URL(request.url).origin;
          void fetch(`${origin}/api/public/cron/regulatory-install-worker`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ install_id: row.id }),
          }).catch(() => {});
        } catch {
          /* cron will pick it up */
        }

        await supabase.from("audit_log").insert({
          actor_user_id: userId,
          tenant_id: parsed.tenant_id,
          scope: "tenant",
          action: "regulatory.pack.install_queued",
          resource_type: "regulatory_pack_installs",
          resource_id: row.id,
          context: { pack_code: pack.pack_code ?? pack.code, version: pack.version, via: "http_api" },
        } as any);

        return json(200, { installId: row.id, reused: false });
      },
    },
  },
});
