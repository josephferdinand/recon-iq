/**
 * Slack Events API — inbound side of the two-way thread sync. Verifies the
 * Slack request signature (v0), handles the url_verification handshake,
 * and records the inbound reply in slack_comment_sync against the mapped
 * thread. The actual break_comments insert is performed by an authenticated
 * reconciler in the ReconIQ UI (break_comments.author_id requires auth.users).
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";

export const Route = createFileRoute("/api/public/chat-ops/slack-events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ts = request.headers.get("x-slack-request-timestamp") ?? "";
        const sig = request.headers.get("x-slack-signature") ?? "";
        const secret = process.env.SLACK_SIGNING_SECRET;
        const body = await request.text();
        if (!secret) return new Response("misconfigured", { status: 500 });

        const tsNum = parseInt(ts, 10);
        if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) {
          return new Response("stale", { status: 401 });
        }
        const expected = "v0=" + createHmac("sha256", secret)
          .update(`v0:${ts}:${body}`)
          .digest("hex");
        const a = Buffer.from(expected);
        const b = Buffer.from(sig);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("bad signature", { status: 401 });
        }

        let payload: any;
        try { payload = JSON.parse(body); } catch { return new Response("bad body", { status: 400 }); }

        if (payload.type === "url_verification") {
          return Response.json({ challenge: payload.challenge });
        }

        if (payload.type === "event_callback" && payload.event?.type === "message") {
          const event = payload.event;
          if (event.bot_id || event.subtype === "bot_message") {
            return Response.json({ ok: true, skipped: "bot" });
          }
          const thread_ts: string = event.thread_ts ?? event.ts;
          const channel_id: string = event.channel;

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: mapping } = await supabaseAdmin
            .from("slack_thread_mappings" as any)
            .select("id,tenant_id,break_id")
            .eq("channel_id", channel_id)
            .eq("thread_ts", thread_ts)
            .maybeSingle();
          if (!mapping) return Response.json({ ok: true, skipped: "no_mapping" });

          await supabaseAdmin
            .from("slack_comment_sync" as any)
            .insert({
              mapping_id: (mapping as any).id,
              slack_message_ts: event.ts,
              direction: "inbound",
            } as any);
          return Response.json({ ok: true, recorded: true });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
