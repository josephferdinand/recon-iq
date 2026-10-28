// Verifies the x-cron-secret header on /api/public/cron/* routes.
// Uses constant-time compare against SLA_CRON_HMAC (rotated quarterly).
//
// LL-088 (2026-08-23): the previous `import { timingSafeEqual } from "crypto"`
// was a bare specifier that resolved to the global `crypto` object (Web Crypto
// API) inside the Cloudflare Workers ESM context, NOT the Node `crypto` module.
// `crypto.timingSafeEqual` does not exist in Web Crypto, so the import
// resolved as `undefined` and the Worker crashed at module-load for every
// /api/public/cron/* route (surfaced as 500 HTML).
//
// Replace with a portable inline constant-time compare that works in both
// Node and Workers. The helper avoids any early-return on length mismatch by
// always XORing into an accumulator.
function constantTimeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  const length = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < length; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export function verifyCronSecret(
  request: Request,
  secretName: "SLA_CRON_HMAC" | "AIDP_JOB_CRON_SECRET" = "SLA_CRON_HMAC",
): Response | null {
  const provided = request.headers.get("x-cron-secret") ?? "";
  // Reject anonymous callers before inspecting runtime configuration. This
  // avoids disclosing whether a deployment has its cron binding configured
  // and keeps preview and production authentication behavior identical.
  if (!provided) {
    return new Response("Unauthorized", { status: 401 });
  }
  // LL-088 (2026-08-23): try `process.env` first, then `globalThis.__env` as
  // a fallback. On Cloudflare Pages, secrets injected via the dashboard
  // surface as `env.SLA_CRON_HMAC` (mirrored to `process.env` for Node
  // compatibility), but the LL-080 case shows that the `process.env` mirror
  // can be empty at runtime on some deploys — in that case `globalThis.__env`
  // (set by `src/server.ts` before the handler runs) is still populated.
  const env = (globalThis as unknown as { __env?: Record<string, string> }).__env ?? {};
  // The live Cloudflare binding is authoritative. A previous build inlined a
  // stale process.env value via Vite, which permanently shadowed the rotated
  // Pages binding and caused every database cron request to return 401. Keep
  // process.env only as the local/Node fallback.
  const expected =
    (env as Record<string, string | undefined>)[secretName] || process.env[secretName] || "";
  if (!expected) {
    return new Response("Cron secret not configured", { status: 503 });
  }
  if (!constantTimeEqual(provided, expected)) {
    // Fire-and-forget security event log; don't await to keep 401 fast.
    void (async () => {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.from("security_events").insert({
          event_type: "cron.unauthorized",
          severity: "warning",
          context: { path: new URL(request.url).pathname },
        } as never);
      } catch {
        /* swallow */
      }
    })();
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}
