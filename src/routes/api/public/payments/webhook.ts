import { createFileRoute } from '@tanstack/react-router';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { type StripeEnv, detectEnvAndVerify } from '@/lib/stripe.server';
import { getPublicCorsOrigin as getCorsOrigin } from '@/lib/public-cors';

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _supabase;
}

function pickPriceId(item: any): string {
  return item?.price?.lookup_key || item?.price?.metadata?.meta_external_id || item?.price?.id;
}

async function notifyPlatform(scope: string, action: string, context: Record<string, unknown>) {
  try {
    await (getSupabase() as any).from('audit_log').insert({
      scope, action, resource_type: 'subscription',
      resource_id: (context.stripe_subscription_id as string) ?? null,
      context,
    } as any);
  } catch (e) { console.error('audit_log insert failed', e); }
}

async function activateTenant(userId: string, priceId: string, env: StripeEnv) {
  // Activation logic: find user's tenant (member of) and activate.
  // If no tenant yet, platform admins will create one upon notification.
  const sb = getSupabase();
  const { data: membership } = await (sb as any).from('tenant_members').select('tenant_id').eq('user_id', userId).limit(1).maybeSingle();
  const tenantId = (membership as any)?.tenant_id as string | undefined;
  if (tenantId) {
    await (sb as any).from('tenants').update({
      subscription_status: 'active',
      subscription_price_id: priceId,
      subscription_activated_at: new Date().toISOString(),
    } as any).eq('id', tenantId);
    await (sb as any).from('subscriptions').update({ tenant_id: tenantId } as any).eq('user_id', userId).eq('environment', env);
  }
  // Always notify platform so admins can confirm/create tenant if needed
  await notifyPlatform('platform', 'subscription.activated', {
    user_id: userId, tenant_id: tenantId ?? null, price_id: priceId, environment: env,
    needs_tenant_creation: !tenantId,
  });
}

async function handleSubscriptionCreated(sub: any, env: StripeEnv) {
  const userId = sub.metadata?.userId;
  if (!userId) { console.error('No userId in subscription metadata'); return; }
  const item = sub.items?.data?.[0];
  const priceId = pickPriceId(item);
  const productId = item?.price?.product;
  const periodStart = item?.current_period_start ?? sub.current_period_start;
  const periodEnd = item?.current_period_end ?? sub.current_period_end;

  await (getSupabase() as any).from('subscriptions').upsert({
    user_id: userId,
    stripe_subscription_id: sub.id,
    stripe_customer_id: sub.customer,
    product_id: productId,
    price_id: priceId,
    status: sub.status,
    current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    environment: env,
    updated_at: new Date().toISOString(),
  } as any, { onConflict: 'stripe_subscription_id' });

  if (sub.status === 'active' || sub.status === 'trialing') {
    await activateTenant(userId, priceId, env);
  }
}

async function handleSubscriptionUpdated(sub: any, env: StripeEnv) {
  const item = sub.items?.data?.[0];
  const priceId = pickPriceId(item);
  const productId = item?.price?.product;
  const periodStart = item?.current_period_start ?? sub.current_period_start;
  const periodEnd = item?.current_period_end ?? sub.current_period_end;

  await (getSupabase() as any).from('subscriptions').update({
    status: sub.status,
    product_id: productId,
    price_id: priceId,
    current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end || false,
    updated_at: new Date().toISOString(),
  } as any).eq('stripe_subscription_id', sub.id).eq('environment', env);

  // Update tenant plan reference on upgrades/downgrades
  const userId = sub.metadata?.userId;
  if (userId) {
    const { data: row } = await (getSupabase() as any).from('subscriptions').select('tenant_id').eq('stripe_subscription_id', sub.id).maybeSingle();
    const tenantId = (row as any)?.tenant_id;
    if (tenantId) {
      await (getSupabase() as any).from('tenants').update({ subscription_price_id: priceId, subscription_status: sub.status } as any).eq('id', tenantId);
    }
    await notifyPlatform('platform', 'subscription.updated', {
      user_id: userId, stripe_subscription_id: sub.id, price_id: priceId, status: sub.status, environment: env,
    });
  }
}

async function handleSubscriptionDeleted(sub: any, env: StripeEnv) {
  await (getSupabase() as any).from('subscriptions').update({ status: 'canceled', updated_at: new Date().toISOString() } as any)
    .eq('stripe_subscription_id', sub.id).eq('environment', env);
  // On cancel: no tenant change (per user spec) — access remains until period_end
  await notifyPlatform('platform', 'subscription.canceled', {
    stripe_subscription_id: sub.id, environment: env,
  });
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const { event } = await detectEnvAndVerify(req);
  // C5: Idempotency — claim event_id; content-hash recorded for forensic verification.
  const sb = getSupabase() as any;
  const payloadHash = createHash('sha256').update(JSON.stringify(event)).digest('hex');
  const { error: idemErr } = await sb.from('stripe_events').insert({
    event_id: event.id, event_type: event.type,
    livemode: !!event.livemode, payload: event, payload_hash: payloadHash,
  } as any);
  if (idemErr) {
    // 23505 unique_violation = duplicate event; ack 200 to stop Stripe retries.
    if ((idemErr as { code?: string }).code === '23505') {
      return { duplicate: true } as const;
    }
    throw idemErr;
  }
  switch (event.type) {
    case 'customer.subscription.created': await handleSubscriptionCreated(event.data.object, env); break;
    case 'customer.subscription.updated': await handleSubscriptionUpdated(event.data.object, env); break;
    case 'customer.subscription.deleted': await handleSubscriptionDeleted(event.data.object, env); break;
    default: console.log('Unhandled event:', event.type);
  }
  await sb.from('stripe_events').update({ processed_at: new Date().toISOString() }).eq('event_id', event.id);
  return { duplicate: false } as const;
}


export const Route = createFileRoute('/api/public/payments/webhook')({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const origin = getCorsOrigin(request.headers.get('origin'));
        const headers: Record<string, string> = {
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'stripe-signature, content-type',
          'access-control-max-age': '86400',
        };
        if (origin) headers['access-control-allow-origin'] = origin;
        return new Response(null, { status: 204, headers });
      },
      POST: async ({ request }) => {
        const origin = getCorsOrigin(request.headers.get('origin'));
        const corsHeaders: Record<string, string> = origin ? { 'access-control-allow-origin': origin } : {};
        // Environment is auto-detected from the Stripe event payload's livemode
        // flag and signature verification — NOT from any query parameter.
        try {
          const { event, env } = await detectEnvAndVerify(request);
          const result = await handleWebhook(request, env);
          if (result.duplicate) return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200, headers: { 'content-type': 'application/json', ...corsHeaders } });
          return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'content-type': 'application/json', ...corsHeaders } });
        } catch (e) {
          console.error('Webhook error:', e);
          return new Response('Webhook error', { status: 400, headers: corsHeaders });
        }
      },
    },
  },
});
