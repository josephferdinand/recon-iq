import { createHmac, timingSafeEqual } from "node:crypto";

// Outbound webhook signing helper.
// Header layout matches GitHub-style: `t=<unix>,v1=<hex>`.
export function signWebhookBody(body: string, secret: string, ts = Math.floor(Date.now() / 1000)) {
  const payload = `${ts}.${body}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return { header: `t=${ts},v1=${sig}`, signature: sig, timestamp: ts };
}

export function verifyWebhookSignature(body: string, header: string | null, secret: string, toleranceSec = 300): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const t = Number(parts.t); const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  const a = Buffer.from(v1, "hex"); const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
