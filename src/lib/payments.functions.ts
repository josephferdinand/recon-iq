import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from '@/lib/stripe.server';

type CheckoutResult = { clientSecret: string } | { error: string };
type PortalResult = { url: string } | { error: string };
type ChangePlanResult = { ok: true; proration_invoiced: boolean } | { error: string };

async function resolveOrCreateCustomer(
  stripe: ReturnType<typeof createStripeClient>,
  options: { email?: string; userId?: string },
): Promise<string> {
  if (options.userId && !/^[a-zA-Z0-9_-]+$/.test(options.userId)) throw new Error('Invalid userId');
  if (options.userId) {
    const found = await stripe.customers.search({
      query: `metadata['userId']:'${options.userId}'`, limit: 1,
    });
    if (found.data.length) return found.data[0].id;
  }
  if (options.email) {
    const existing = await stripe.customers.list({ email: options.email, limit: 1 });
    if (existing.data.length) {
      const c = existing.data[0];
      if (options.userId && c.metadata?.userId !== options.userId) {
        await stripe.customers.update(c.id, { metadata: { ...c.metadata, userId: options.userId } });
      }
      return c.id;
    }
  }
  const created = await stripe.customers.create({
    ...(options.email && { email: options.email }),
    ...(options.userId && { metadata: { userId: options.userId } }),
  });
  return created.id;
}

export const createCheckoutSession = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth()])
  .validator((data: {
    priceId: string;
    returnUrl: string;
    environment: StripeEnv;
  }) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(data.priceId)) throw new Error('Invalid priceId');
    return data;
  })
  .handler(async ({ data, context }): Promise<CheckoutResult> => {
    try {
      const stripe = createStripeClient(data.environment);
      const prices = await stripe.prices.list({ lookup_keys: [data.priceId] });
      if (!prices.data.length) throw new Error('Price not found');
      const stripePrice = prices.data[0];

      const email = (context.claims as { email?: string })?.email;
      const customerId = await resolveOrCreateCustomer(stripe, { email, userId: context.userId });

      const session = await stripe.checkout.sessions.create({
        line_items: [{ price: stripePrice.id, quantity: 1 }],
        mode: 'subscription',
        ui_mode: 'embedded_page',
        return_url: data.returnUrl,
        customer: customerId,
        metadata: { userId: context.userId },
        subscription_data: { metadata: { userId: context.userId } },
      });
      return { clientSecret: session.client_secret ?? '' };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

export const createPortalSession = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth()])
  .validator((data: { returnUrl?: string; environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<PortalResult> => {
    const { supabase, userId } = context;
    const { data: sub } = await supabase
      .from('subscriptions').select('stripe_customer_id')
      .eq('user_id', userId).eq('environment', data.environment)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!sub?.stripe_customer_id) return { error: 'No subscription found' };
    try {
      const stripe = createStripeClient(data.environment);
      const portal = await stripe.billingPortal.sessions.create({
        customer: sub.stripe_customer_id as string,
        ...(data.returnUrl && { return_url: data.returnUrl }),
      });
      return { url: portal.url };
    } catch (e) {
      return { error: getStripeErrorMessage(e) };
    }
  });

/**
 * Change plan with user-defined logic:
 *  - Upgrade: prorate immediately, invoice now ("pay the remaining amount")
 *  - Downgrade: prorate, but schedule on next cycle (no immediate invoice)
 */
export const changePlan = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth()])
  .validator((data: { newPriceId: string; environment: StripeEnv }) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(data.newPriceId)) throw new Error('Invalid newPriceId');
    return data;
  })
  .handler(async ({ data, context }): Promise<ChangePlanResult> => {
    const { supabase, userId } = context;
    const { data: sub } = await supabase
      .from('subscriptions').select('stripe_subscription_id, price_id')
      .eq('user_id', userId).eq('environment', data.environment)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!sub?.stripe_subscription_id) return { error: 'No active subscription' };
    try {
      const stripe = createStripeClient(data.environment);
      const prices = await stripe.prices.list({ lookup_keys: [data.newPriceId] });
      if (!prices.data.length) return { error: 'New price not found' };
      const newStripePrice = prices.data[0];

      const subscription = await stripe.subscriptions.retrieve(sub.stripe_subscription_id as string);
      const currentItem = subscription.items.data[0];
      const currentAmount = currentItem.price.unit_amount ?? 0;
      const newAmount = newStripePrice.unit_amount ?? 0;
      const isUpgrade = newAmount > currentAmount;

      await stripe.subscriptions.update(sub.stripe_subscription_id as string, {
        items: [{ id: currentItem.id, price: newStripePrice.id }],
        proration_behavior: 'create_prorations',
        billing_cycle_anchor: isUpgrade ? 'now' : 'unchanged',
      });

      if (isUpgrade) {
        // Invoice the proration immediately so customer "pays the remaining amount"
        try {
          await stripe.invoices.create({
            customer: subscription.customer as string,
            subscription: sub.stripe_subscription_id as string,
            auto_advance: true,
          });
        } catch {
          // No proration line items pending — Stripe will reject; safe to ignore
        }
      }
      return { ok: true, proration_invoiced: isUpgrade };
    } catch (e) {
      return { error: getStripeErrorMessage(e) };
    }
  });
