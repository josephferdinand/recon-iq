import { createFileRoute } from "@tanstack/react-router";
import { safeSupabaseError, safeErrorResponse } from "@/lib/safe-error.server";

// Outbound Chat-Ops dispatcher for ReconIQ.
// Call via cron (pg_cron or external scheduler) every minute:
//   POST https://<your-deployment-domain>/api/public/chat-ops/dispatch
//   Authorization: Bearer <CRON_SECRET>
//
// Pulls pending rows from webhook_outbox and fans them out to
// chat_ops_subscriptions whose `events` array includes the row's event name.

const MAX_BATCH = 50;

type OutboxRow = {
  id: string;
  tenant_id: string;
  event: string;
  payload: Record<string, unknown> | null;
  attempts: number;
};

function renderSlackText(event: string, payload: Record<string, unknown> | null): string {
  const p = payload ?? {};
  switch (event) {
    case "exception.open":
      return `:rotating_light: *New break* \`${String(p.id ?? "").slice(0, 8)}\` — ${p.reason ?? "(no reason)"} · severity *${p.severity ?? "med"}*`;
    case "exception.close":
      return `:lock: *Break closed* \`${String(p.id ?? "").slice(0, 8)}\` — ${p.reason ?? "(no reason)"}`;
    case "exception.assign":
      return `:bust_in_silhouette: *Break assigned* \`${String(p.id ?? "").slice(0, 8)}\` → ${p.assignee_email ?? p.assignee ?? "(unknown)"}`;
    case "run.completed":
      return `:white_check_mark: *Recon run completed* — ${p.recon_name ?? p.run_id ?? "(run)"} · matched ${p.matched ?? 0}, breaks ${p.breaks ?? 0}`;
    default:
      return `:bell: ${event} — \`\`\`${JSON.stringify(p).slice(0, 500)}\`\`\``;
  }
}

export const Route = createFileRoute("/api/public/chat-ops/dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.CRON_SECRET;
        if (!secret) {
          // S-3 — sanitize upstream errors: log server-side, return generic to client.
          console.error("[chat-ops/dispatch] CRON_SECRET is not configured");
          return new Response("Service unavailable", { status: 503 });
        }
        const auth = request.headers.get("authorization") ?? "";
        if (auth !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: rows, error } = await supabaseAdmin
          .from("webhook_outbox")
          .select("id,tenant_id,event,payload,attempts")
          .eq("status", "pending")
          .lte("next_attempt_at", new Date().toISOString())
          .order("created_at", { ascending: true })
          .limit(MAX_BATCH);
        if (error) return safeErrorResponse(safeSupabaseError(error, { path: "/api/public/chat-ops/dispatch" }));

        let delivered = 0;
        let skipped = 0;
        let failed = 0;

        for (const row of (rows ?? []) as OutboxRow[]) {
          const { data: subs } = await supabaseAdmin
            .from("chat_ops_subscriptions")
            .select("id,platform,webhook_url,events,enabled")
            .eq("tenant_id", row.tenant_id)
            .eq("enabled", true);

          const matches = (subs ?? []).filter(
            (s) => Array.isArray(s.events) && (s.events as string[]).includes(row.event) && !!s.webhook_url,
          );

          if (matches.length === 0) {
            await supabaseAdmin
              .from("webhook_outbox")
              .update({ status: "skipped", last_error: "no matching subscription", updated_at: new Date().toISOString() })
              .eq("id", row.id);
            skipped++;
            continue;
          }

          let allOk = true;
          let lastErr: string | null = null;
          for (const sub of matches) {
            try {
              const body =
                sub.platform === "slack" || sub.platform === "teams"
                  ? { text: renderSlackText(row.event, row.payload) }
                  : { event: row.event, payload: row.payload };
              const r = await fetch(sub.webhook_url as string, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
              if (!r.ok) {
                allOk = false;
                lastErr = `HTTP ${r.status} for sub ${sub.id}`;
              } else {
                await supabaseAdmin.from("webhook_deliveries").insert({
                  subscription_id: sub.id,
                  tenant_id: row.tenant_id,
                  event: row.event,
                  payload: row.payload ?? {},
                  response_status: r.status,
                  attempt: (row.attempts ?? 0) + 1,
                  delivered_at: new Date().toISOString(),
                } as never);
              }
            } catch (e) {
              allOk = false;
              lastErr = String((e as Error).message ?? e);
            }
          }

          if (allOk) {
            await supabaseAdmin
              .from("webhook_outbox")
              .update({ status: "delivered", updated_at: new Date().toISOString() })
              .eq("id", row.id);
            delivered++;
          } else {
            const attempts = (row.attempts ?? 0) + 1;
            const dead = attempts >= 8;
            const backoffMin = Math.min(60, 2 ** attempts);
            await supabaseAdmin
              .from("webhook_outbox")
              .update({
                status: dead ? "failed" : "pending",
                attempts,
                last_error: lastErr,
                next_attempt_at: new Date(Date.now() + backoffMin * 60_000).toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("id", row.id);
            failed++;
          }
        }

        return Response.json({ ok: true, processed: rows?.length ?? 0, delivered, skipped, failed });
      },
    },
  },
});
