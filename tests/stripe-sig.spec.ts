import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "node:crypto";

beforeAll(() => {
  process.env.PAYMENTS_SANDBOX_WEBHOOK_SECRET = "whsec_test_sandbox";
});

async function makeReq(sigHeader: string, body = '{"id":"evt_1","type":"x","livemode":false,"data":{"object":{}}}') {
  return new Request("https://x/y", {
    method: "POST",
    headers: { "stripe-signature": sigHeader, "content-type": "application/json" },
    body,
  });
}

function validSigFor(body: string, secret: string, ts: number) {
  const expected = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return `t=${ts},v1=${expected}`;
}

describe("S-3 Stripe v1= signature scheme check", () => {
  it("rejects an unknown scheme prefix (v2=...)", async () => {
    const { verifyWebhook } = await import("@/lib/stripe.server");
    const ts = Math.floor(Date.now() / 1000);
    const req = await makeReq(`t=${ts},v2=deadbeef`);
    await expect(verifyWebhook(req, "sandbox")).rejects.toThrow(/invalid_signature_scheme|Invalid signature format/);
  });

  it("accepts a correctly-prefixed v1= signature", async () => {
    const { verifyWebhook } = await import("@/lib/stripe.server");
    const body = '{"id":"evt_1","type":"x","livemode":false,"data":{"object":{}}}';
    const ts = Math.floor(Date.now() / 1000);
    const req = await makeReq(validSigFor(body, "whsec_test_sandbox", ts), body);
    const ev = await verifyWebhook(req, "sandbox");
    expect(ev.id).toBe("evt_1");
  });
});
