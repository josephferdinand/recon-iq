import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getPublicCorsOrigin as getCorsOrigin } from "@/lib/public-cors";

function corsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin = getCorsOrigin(requestOrigin);
  return origin ? { "access-control-allow-origin": origin } : {};
}

const CORS = {
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const EVENT_TYPES = ["view", "click", "form_submit", "pack_download"] as const;

const MAX_META_BYTES = 4 * 1024;

const inputSchema = z.object({
  event_type: z.enum(EVENT_TYPES),
  cta_id: z.string().trim().min(1).max(120),
  source: z.string().trim().max(200).optional(),
  page_path: z.string().trim().max(500).optional(),
  referrer: z.string().trim().max(500).optional(),
  region: z.string().trim().max(80).optional(),
  session_id: z.string().trim().max(120).optional(),
  lead_id: z.string().uuid().optional(),
  utm: z
    .object({
      utm_source: z.string().max(120).optional(),
      utm_medium: z.string().max(120).optional(),
      utm_campaign: z.string().max(120).optional(),
      utm_content: z.string().max(200).optional(),
      utm_term: z.string().max(200).optional(),
    })
    .optional(),
  meta: z.record(z.unknown()).optional(),
});

function json(body: unknown, status: number, requestOrigin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS, ...corsHeaders(requestOrigin) },
  });
}

export const Route = createFileRoute("/api/public/mkt-cta-events")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => {
        const co = getCorsOrigin(request.headers.get("origin"));
        return new Response(null, {
          status: 204,
          headers: { ...CORS, ...(co ? { "access-control-allow-origin": co } : {}) },
        });
      },
      POST: async ({ request }) => {
        const origin = request.headers.get("origin");
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "invalid_json" }, 400, origin);
        }
        const parsed = inputSchema.safeParse(body);
        if (!parsed.success) {
          return json({ error: "validation_failed", details: parsed.error.flatten() }, 400, origin);
        }
        const input = parsed.data;
        if (
          input.meta &&
          new TextEncoder().encode(JSON.stringify(input.meta) ?? "").byteLength > MAX_META_BYTES
        ) {
          return json({ error: "payload_too_large" }, 413, origin);
        }

        // Region: prefer client-supplied hint, else Cloudflare edge header
        const cfCountry = request.headers.get("cf-ipcountry");
        const region = input.region || (cfCountry && cfCountry !== "XX" ? cfCountry : null);

        const ipHeader = request.headers.get("x-forwarded-for") ?? "";
        const ip = ipHeader.split(",")[0]?.trim() || null;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // Types regenerate on next build; cast so the new table is writable in the meantime.
        const client = supabaseAdmin as unknown as {
          from: (table: string) => {
            insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
          };
        };
        const { error } = await client.from("mkt_cta_events").insert({
          event_type: input.event_type,
          cta_id: input.cta_id,
          source: input.source ?? null,
          page_path: input.page_path ?? null,
          referrer: input.referrer ?? null,
          region,
          session_id: input.session_id ?? null,
          lead_id: input.lead_id ?? null,
          utm_source: input.utm?.utm_source ?? null,
          utm_medium: input.utm?.utm_medium ?? null,
          utm_campaign: input.utm?.utm_campaign ?? null,
          utm_content: input.utm?.utm_content ?? null,
          utm_term: input.utm?.utm_term ?? null,
          user_agent: request.headers.get("user-agent") ?? null,
          ip,
          meta: (input.meta ?? {}) as Record<string, unknown>,
        });

        if (error) return json({ error: "insert_failed" }, 500, origin);
        return json({ ok: true }, 200, origin);
      },
    },
  },
});
