/**
 * Inbound email -> break parser. Accepts a Mailgun/SendGrid-style POST,
 * dedupes on (tenant_id, Message-ID), and links the email to a break when
 * the subject contains a break reference like [BRK-xxxx-...]. The actual
 * break_comments insert is left to an authenticated reconciler in the
 * ReconIQ UI (break_comments.author_id requires auth.users).
 *
 * Tenant routing is by recipient address mailbox prefix:
 *   ops+<tenant_slug>@<inbox-domain>
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { safeErrorResponse, safeSupabaseError } from "@/lib/safe-error.server";

const PATH = "/api/public/chat-ops/inbound-email";

export const Route = createFileRoute("/api/public/chat-ops/inbound-email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.INBOUND_EMAIL_SECRET;
        if (!secret) return new Response("misconfigured", { status: 500 });
        const sig = request.headers.get("x-inbound-signature") ?? "";
        const body = await request.text();
        const expected = createHmac("sha256", secret).update(body).digest("hex");
        const a = Buffer.from(expected);
        const b = Buffer.from(sig);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("bad signature", { status: 401 });
        }
        const payload = JSON.parse(body) as {
          to: string;
          from: string;
          subject?: string;
          message_id: string;
          in_reply_to?: string;
          text?: string;
          attachments?: number;
        };

        const m = payload.to.match(/ops\+([a-z0-9-]+)@/i);
        if (!m) return Response.json({ ok: false, reason: "no_tenant_prefix" }, { status: 400 });
        const slug = m[1];
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("id")
          .eq("slug", slug)
          .maybeSingle();
        if (!tenant) return Response.json({ ok: false, reason: "tenant_not_found" }, { status: 404 });
        const tenant_id = (tenant as any).id as string;

        const { data: existing } = await supabaseAdmin
          .from("chat_ops_inbound_emails" as any)
          .select("id,parse_status")
          .eq("tenant_id", tenant_id)
          .eq("message_id", payload.message_id)
          .maybeSingle();
        if (existing) {
          return Response.json({ ok: true, deduped: true, id: (existing as any).id });
        }

        const brkMatch = payload.subject?.match(/\[BRK-([0-9a-f-]{8,})\]/i);
        let break_id: string | null = null;
        if (brkMatch) {
          const { data: brk } = await supabaseAdmin
            .from("recon_exceptions")
            .select("id")
            .eq("tenant_id", tenant_id)
            .ilike("id", `${brkMatch[1]}%`)
            .maybeSingle();
          break_id = (brk as any)?.id ?? null;
        }

        const status = break_id ? "linked" : "quarantined";
        const { data: row, error } = await supabaseAdmin
          .from("chat_ops_inbound_emails" as any)
          .insert({
            tenant_id,
            message_id: payload.message_id,
            from_email: payload.from,
            subject: payload.subject ?? null,
            body_text: (payload.text ?? "").slice(0, 8000),
            break_id,
            parse_status: status,
            attachments_count: payload.attachments ?? 0,
          } as any)
          .select("id")
          .single();
        if (error) return safeErrorResponse(safeSupabaseError(error, { tenantId: tenant_id, path: PATH }));
        return Response.json({ ok: true, id: (row as any).id, status, break_id });
      },
    },
  },
});
