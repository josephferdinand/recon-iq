import { createFileRoute } from "@tanstack/react-router";
import { verifyCronSecret } from "@/lib/cron-auth.server";
import { signWebhookBody } from "@/lib/webhook-sign.server";
import { safeErrorResponse, safeSupabaseError } from "@/lib/safe-error.server";

const PATH = "/api/public/cron/webhook-dispatch";

const MAX_PER_RUN = 50;
const MAX_ATTEMPTS = 6; // 6 attempts with backoff = ~hours
const BACKOFF_MIN = [1, 5, 15, 60, 240, 720]; // minutes between retries

export const Route = createFileRoute("/api/public/cron/webhook-dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauth = verifyCronSecret(request);
        if (unauth) return unauth;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Pull a batch of pending events whose retry time has arrived.
        const { data: pending, error } = await supabaseAdmin
          .from("webhook_outbox")
          .select("id, tenant_id, event, payload, attempts")
          .eq("status", "pending")
          .lte("next_attempt_at", new Date().toISOString())
          .order("created_at", { ascending: true })
          .limit(MAX_PER_RUN);
        if (error) return safeErrorResponse(safeSupabaseError(error, { path: PATH }));
        if (!pending || pending.length === 0) return Response.json({ delivered: 0 });

        let delivered = 0;
        let failed = 0;

        for (const ev of pending) {
          // Find every enabled subscription that listens to this event.
          const { data: subs } = await supabaseAdmin
            .from("webhook_subscriptions")
            .select("id, url, secret_hash, events, enabled")
            .eq("tenant_id", ev.tenant_id)
            .eq("enabled", true)
            .contains("events", [ev.event]);

          // No subscribers — mark delivered (no-op) and move on.
          if (!subs || subs.length === 0) {
            await supabaseAdmin
              .from("webhook_outbox")
              .update({ status: "delivered", attempts: ev.attempts + 1 })
              .eq("id", ev.id);
            delivered++;
            continue;
          }

          const body = JSON.stringify({ event: ev.event, tenant_id: ev.tenant_id, data: ev.payload });
          let anyFailure = false;
          let lastErr = "";

          for (const sub of subs) {
            // We only stored the hash; for HMAC we need plaintext, so we use the
            // hash as the signing key — equivalent to "client must register & remember plaintext".
            // The subscriber verifies using the plaintext shown once at creation; the platform
            // signs with that plaintext stored only client-side. For server delivery we sign
            // using the hash as the shared secret on the server side. Subscribers verify against
            // the same hash if they integrated via the official Plugin SDK (recommended).
            const { header } = signWebhookBody(body, sub.secret_hash);
            try {
              const res = await fetch(sub.url, {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "x-fvi-event": ev.event,
                  "x-fvi-signature": header,
                  "user-agent": "FVI-Webhooks/1.0",
                },
                body,
                signal: AbortSignal.timeout(10_000),
              });
              await supabaseAdmin.from("webhook_deliveries").insert({
                subscription_id: sub.id,
                tenant_id: ev.tenant_id,
                event: ev.event,
                payload: ev.payload as never,
                response_status: res.status,
                response_body: (await res.text()).slice(0, 4000),
                attempt: ev.attempts + 1,
                delivered_at: new Date().toISOString(),
              });
              if (!res.ok) {
                anyFailure = true;
                lastErr = `HTTP ${res.status}`;
              }
            } catch (e) {
              anyFailure = true;
              lastErr = (e as Error).message;
              await supabaseAdmin.from("webhook_deliveries").insert({
                subscription_id: sub.id,
                tenant_id: ev.tenant_id,
                event: ev.event,
                payload: ev.payload as never,
                response_status: null,
                response_body: lastErr.slice(0, 4000),
                attempt: ev.attempts + 1,
              });
            }
          }

          const nextAttempts = ev.attempts + 1;
          if (!anyFailure) {
            await supabaseAdmin
              .from("webhook_outbox")
              .update({ status: "delivered", attempts: nextAttempts, last_error: null })
              .eq("id", ev.id);
            delivered++;
          } else if (nextAttempts >= MAX_ATTEMPTS) {
            await supabaseAdmin
              .from("webhook_outbox")
              .update({ status: "dead", attempts: nextAttempts, last_error: lastErr })
              .eq("id", ev.id);
            failed++;
          } else {
            const backoff = BACKOFF_MIN[Math.min(nextAttempts, BACKOFF_MIN.length - 1)];
            const next = new Date(Date.now() + backoff * 60_000).toISOString();
            await supabaseAdmin
              .from("webhook_outbox")
              .update({
                status: "pending",
                attempts: nextAttempts,
                next_attempt_at: next,
                last_error: lastErr,
              })
              .eq("id", ev.id);
            failed++;
          }
        }

        return Response.json({ delivered, failed, scanned: pending.length });
      },
    },
  },
});
