// Server-only helper to enqueue webhook events into the outbox.
// Call from server functions whenever a domain event happens.
// The dispatcher cron (/api/public/cron/webhook-dispatch) will sign and POST.

import type { SupabaseClient } from "@supabase/supabase-js";

export async function enqueueWebhookEvent(
  client: SupabaseClient,
  args: { tenantId: string; event: string; payload: Record<string, unknown> },
): Promise<void> {
  // Skip if no subscriptions match — cheap pre-filter (still safe under RLS).
  const { data: subs } = await client
    .from("webhook_subscriptions")
    .select("id")
    .eq("tenant_id", args.tenantId)
    .eq("enabled", true)
    .contains("events", [args.event])
    .limit(1);
  if (!subs || subs.length === 0) return;

  const { error } = await client.from("webhook_outbox").insert({
    tenant_id: args.tenantId,
    event: args.event,
    payload: args.payload as never,
  });
  if (error) {
    // Never block the parent transaction for outbox failures.
    console.warn("[webhook-emit] enqueue failed", error.message);
  }
}
