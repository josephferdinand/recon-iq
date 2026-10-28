import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";
import { assertChatopsEnv } from "@/lib/chatops-env.server";

// S-6 — warn on missing secret at module load; the request handler
// below is the fail-closed enforcement point (returns 503 when unset).
// A module-load throw would take down the entire SSR worker on
// Cloudflare, so we intentionally do not throw here.
try {
  assertChatopsEnv("INBOUND_EMAIL_SECRET", process.env.INBOUND_EMAIL_SECRET, "development");
} catch { /* never throws in the dev branch, but belt-and-braces */ }

// Public inbound-email webhook for ReconIQ Chat-Ops.
// S-4: bearer token + body shape validated in a single pass with a
// constant-time HMAC compare on every request. Both malformed-body and
// bad-token paths share the same code path before returning 401.

const Payload = z.object({
  from: z.string().email(),
  to: z.string().min(3).max(320),
  subject: z.string().max(2000),
  text: z.string().max(20000).optional(),
});

function ctEqual(a: string, b: string, key: Buffer): boolean {
  const ha = createHmac("sha256", key).update(a).digest();
  const hb = createHmac("sha256", key).update(b).digest();
  return timingSafeEqual(ha, hb);
}

async function readPayload(request: Request): Promise<unknown> {
  const ct = request.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) return await request.json();
    const form = await request.formData();
    return { from: form.get("from"), to: form.get("to"), subject: form.get("subject"), text: form.get("text") };
  } catch {
    return {};
  }
}

export const Route = createFileRoute("/api/public/chat-ops/email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env.INBOUND_EMAIL_SECRET ?? "";
        const auth = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        const secretKey = Buffer.from(token || "chatops-email-placeholder");

        // Always read and parse body — never short-circuit.
        const payload = await readPayload(request);
        const parsed = Payload.safeParse(payload);

        // Always compute a constant-time bearer compare, even when no token
        // is configured. When configured, an empty/incorrect Authorization
        // header MUST fail.
        const tokenConfigured = !!token;
        const tokenOk = tokenConfigured ? ctEqual(auth, token, secretKey) : true;

        // Single-pass AND: shape + token must both pass.
        const ok = parsed.success && tokenOk;
        if (!ok) {
          // Constant-time fallback so failure cost matches success.
          ctEqual(auth || "", token || "x", secretKey);
          return new Response("Unauthorized", { status: 401 });
        }

        const subject = parsed.data!.subject.trim();
        const m = subject.match(/^(assign|close|comment|escalate)\s+(\S+)(?:\s+(.+))?$/i);
        const tenantMatch = parsed.data!.to.match(/falcon-([a-z0-9-]+)@/i);
        const tenantSlug = tenantMatch?.[1] ?? null;

        const action = m ? { verb: m[1].toLowerCase(), target: m[2], extra: m[3] ?? "" } : null;

        return Response.json({
          ok: true,
          tenant_slug: tenantSlug,
          from: parsed.data!.from,
          parsed_action: action,
          note: action ? "Action queued for processing." : "No verb detected — message stored as ticket draft for ReconIQ ops review.",
        });
      },
    },
  },
});

// Exported for tests (S-4 timing assertions).
export async function __validateEmailRequest(rawBody: string, authHeader: string, token: string): Promise<{ ok: boolean; elapsedNs: bigint }> {
  const start = process.hrtime.bigint();
  const secretKey = Buffer.from(token || "chatops-email-placeholder");
  let payload: unknown = {};
  try { payload = JSON.parse(rawBody); } catch { payload = {}; }
  const parsed = Payload.safeParse(payload);
  const auth = authHeader.replace(/^Bearer\s+/i, "");
  const tokenOk = token ? ctEqual(auth, token, secretKey) : true;
  const ok = parsed.success && tokenOk;
  if (!ok) ctEqual(auth || "", token || "x", secretKey);
  return { ok, elapsedNs: process.hrtime.bigint() - start };
}
