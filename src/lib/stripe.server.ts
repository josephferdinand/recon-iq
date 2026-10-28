import Stripe from 'stripe';

const getEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not configured`);
  return value;
};

export type StripeEnv = 'sandbox' | 'live';

export function getConnectionApiKey(env: StripeEnv): string {
  return env === 'sandbox'
    ? getEnv('STRIPE_SANDBOX_API_KEY')
    : getEnv('STRIPE_LIVE_API_KEY');
}

/**
 * Direct Stripe SDK client. Uses the official Stripe Node SDK against
 * api.stripe.com — no connector-gateway proxy. The SDK handles all HTTP
 * (retries, idempotency, pagination) via its default fetch transport.
 *
 * Callers use stripe.customers.create, stripe.checkout.sessions.create,
 * stripe.events.retrieve, etc., directly.
 */
export function createStripeClient(env: StripeEnv): Stripe {
  const apiKey = getConnectionApiKey(env);
  return new Stripe(apiKey, {
    apiVersion: '2026-03-25.dahlia',
  });
}

export function getStripeErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { message?: string; raw?: { message?: string } };
    return e.raw?.message ?? e.message ?? 'Stripe request failed';
  }
  return 'Stripe request failed';
}

/**
 * Parse the Stripe-Signature header and extract timestamp + v1 values.
 */
function parseSignature(signature: string): { timestamp: string; v1: string[] } {
  let timestamp: string | undefined;
  const v1: string[] = [];
  for (const part of signature.split(',')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq);
    const v = trimmed.slice(eq + 1);
    if (k === 't') timestamp = v;
    else if (k === 'v1') {
      if (!trimmed.startsWith('v1=')) throw new Error('invalid_signature_scheme');
      v1.push(v);
    } else if (k.startsWith('v')) {
      throw new Error('invalid_signature_scheme');
    }
  }
  if (!timestamp || !v1.length) throw new Error('Invalid signature format');
  return { timestamp, v1 };
}

/**
 * Compute the expected v1 HMAC for a given timestamp + body + secret.
 */
async function computeExpectedV1(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  return Buffer.from(new Uint8Array(signed)).toString('hex');
}

/**
 * Verify a Stripe webhook signature against a specific environment secret.
 */
async function verifySignature(secret: string, signature: string, body: string): Promise<void> {
  const { timestamp, v1 } = parseSignature(signature);
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    throw new Error('Webhook timestamp too old');
  }
  const expected = await computeExpectedV1(secret, timestamp, body);
  if (!v1.includes(expected)) throw new Error('Invalid webhook signature');
}

/**
 * Verify a Stripe webhook for a known environment.
 * @deprecated Use detectEnvAndVerify() for new code — it auto-detects the
 * environment from the Stripe `livemode` flag instead of trusting caller input.
 */
export async function verifyWebhook(req: Request, env: StripeEnv): Promise<{ id: string; type: string; livemode: boolean; data: { object: any } }> {
  const signature = req.headers.get('stripe-signature');
  const body = await req.text();
  if (!signature || !body) throw new Error('Missing signature or body');

  const secret = env === 'sandbox'
    ? getEnv('PAYMENTS_SANDBOX_WEBHOOK_SECRET')
    : getEnv('PAYMENTS_LIVE_WEBHOOK_SECRET');

  await verifySignature(secret, signature, body);
  const event = JSON.parse(body) as { id: string; type: string; livemode: boolean; data: { object: any } };

  // Cross-check: livemode in the payload must match the expected environment
  if (event.livemode && env !== 'live') throw new Error('livemode_mismatch: event is live but sandbox secret used');
  if (!event.livemode && env !== 'sandbox') throw new Error('livemode_mismatch: event is test but live secret used');

  return event;
}

/**
 * Auto-detect the Stripe environment by trying both webhook secrets and
 * cross-checking the event's `livemode` flag. Returns the verified event
 * and the detected environment.
 *
 * This eliminates the need for callers to pass an `env` parameter, closing
 * the confusion attack where a caller could force sandbox/live routing.
 */
export async function detectEnvAndVerify(req: Request): Promise<{ event: { id: string; type: string; livemode: boolean; data: { object: any } }; env: StripeEnv }> {
  const signature = req.headers.get('stripe-signature');
  const body = await req.text();
  if (!signature || !body) throw new Error('Missing signature or body');

  const liveSecret = getEnv('PAYMENTS_LIVE_WEBHOOK_SECRET');
  const sandboxSecret = getEnv('PAYMENTS_SANDBOX_WEBHOOK_SECRET');

  // Try live first (most common in production). We attempt verification
  // against BOTH secrets so an attacker can't detect which is configured
  // via timing — both paths always execute.
  let liveError: Error | null = null;
  let sandboxError: Error | null = null;

  try { await verifySignature(liveSecret, signature, body); }
  catch (e) { liveError = e instanceof Error ? e : new Error(String(e)); }

  try { await verifySignature(sandboxSecret, signature, body); }
  catch (e) { sandboxError = e instanceof Error ? e : new Error(String(e)); }

  const event = JSON.parse(body) as { id: string; type: string; livemode: boolean; data: { object: any } };

  if (event.livemode && !liveError) {
    return { event, env: 'live' };
  }
  if (!event.livemode && !sandboxError) {
    return { event, env: 'sandbox' };
  }

  // If both fail or there's a livemode mismatch, reject
  if (liveError && sandboxError) throw new Error('Invalid webhook signature (both secrets failed)');
  if (event.livemode && sandboxError) throw new Error('Invalid webhook signature (live event, sandbox secret mismatch)');
  if (!event.livemode && liveError) throw new Error('Invalid webhook signature (test event, live secret mismatch)');
  throw new Error('livemode_mismatch: environment detection failed');
}
