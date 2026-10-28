import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getPublicCorsOrigin as getCorsOrigin } from "@/lib/public-cors";
import { safeSupabaseError } from "@/lib/safe-error.server";

const CORS = {
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

const bookInput = z.object({
  slug: z.string().min(1).max(60),
  start_at: z.string().datetime(),
  attendee_name: z.string().min(1).max(120),
  attendee_email: z.string().email().max(200),
  notes: z.string().max(2000).optional().nullable(),
  lead_id: z.string().uuid().optional().nullable(),
  source: z.string().max(40).optional(),
});

function json(body: unknown, status = 200, requestOrigin?: string | null) {
  const origin = getCorsOrigin(requestOrigin ?? null);
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS,
      ...(origin ? { "access-control-allow-origin": origin } : {}),
    },
  });
}

const ERROR_MAP: Record<string, { status: number; message: string }> = {
  invalid_email: { status: 400, message: "That email address isn't valid." },
  unknown_or_inactive_type: { status: 404, message: "That appointment type isn't available." },
  too_soon: { status: 409, message: "That slot is inside the minimum notice window." },
  too_far_out: { status: 409, message: "That slot is beyond the booking horizon." },
  day_full: { status: 409, message: "No more openings that day." },
  slot_taken: { status: 409, message: "Someone just booked that slot. Please pick another." },
};

export const Route = createFileRoute("/api/public/mkt-appointments")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => {
        const origin = getCorsOrigin(request.headers.get("origin"));
        return new Response(null, {
          status: 204,
          headers: { ...CORS, ...(origin ? { "access-control-allow-origin": origin } : {}) },
        });
      },

      // GET /api/public/mkt-appointments?slug=...&from=...&days=7
      // GET /api/public/mkt-appointments (list active types only)
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const slug = url.searchParams.get("slug");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        if (!slug) {
          const { data, error } = await supabaseAdmin
            .from("mkt_appointment_types")
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .select("slug,name,description,duration_min,timezone,location,requires_approval,booking_instructions" as any)
            .eq("is_active", true)
            .order("name", { ascending: true });
          if (error) {
            const safe = safeSupabaseError(error, { path: "/api/public/mkt-appointments" });
            return json({ error: safe.body.error }, 500, request.headers.get("origin"));
          }
          return json({ types: data ?? [] }, 200, request.headers.get("origin"));
        }
        try {
          const { getPublicAvailability } = await import("@/lib/mkt-appointments.functions");
          const days = Number(url.searchParams.get("days") ?? "7");
          const from = url.searchParams.get("from") ?? undefined;
          const out = await getPublicAvailability({ data: { slug, from, days } });
          return json(out, 200, request.headers.get("origin"));
        } catch (err) {
          const msg = (err as Error).message;
          if (msg === "unknown_or_inactive_type") {
            return json({ error: "unknown_or_inactive_type" }, 404, request.headers.get("origin"));
          }
          const safe = safeSupabaseError({ message: msg }, { path: "/api/public/mkt-appointments" });
          return json({ error: safe.body.error }, 500, request.headers.get("origin"));
        }
      },

      POST: async ({ request }) => {
        const origin = request.headers.get("origin");
        let payload: unknown;
        try { payload = await request.json(); }
        catch { return json({ error: "invalid_json" }, 400, origin); }
        const parsed = bookInput.safeParse(payload);
        if (!parsed.success) return json({ error: "invalid_input", details: parsed.error.flatten() }, 400, origin);
        const input = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabaseAdmin as any).rpc("mkt_book_appointment", {
          _type_slug: input.slug,
          _start_at: input.start_at,
          _attendee_name: input.attendee_name,
          _attendee_email: input.attendee_email,
          _notes: input.notes ?? null,
          _lead_id: input.lead_id ?? null,
          _source: input.source ?? "public",
        });
        if (error) {
          const raw = (error.message || "").toLowerCase();
          const code = Object.keys(ERROR_MAP).find((k) => raw.includes(k));
          if (code) return json({ ok: false, code, error: ERROR_MAP[code].message }, ERROR_MAP[code].status, origin);
          return json({ ok: false, error: "Something went wrong. Please try again." }, 500, origin);
        }
        const row = Array.isArray(data) ? data[0] : data;
        return json({
          ok: true,
          booking: {
            id: row?.id, status: row?.status,
            start_at: row?.start_at, end_at: row?.end_at,
            type_name: row?.type_name,
          },
        }, 200, origin);
      },
    },
  },
});
