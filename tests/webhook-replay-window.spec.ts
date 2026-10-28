// E1 — Webhook replay-window enforcement.
import { describe, it, expect } from "vitest";
import { signWebhookBody, verifyWebhookSignature } from "@/lib/webhook-sign.server";

describe("verifyWebhookSignature 5-minute tolerance", () => {
  const secret = "s3cret";
  const body = JSON.stringify({ hello: "world" });

  it("fresh timestamp passes", () => {
    const { header } = signWebhookBody(body, secret);
    expect(verifyWebhookSignature(body, header, secret)).toBe(true);
  });

  it("10-minute-old timestamp is rejected (replay window exceeded)", () => {
    const oldTs = Math.floor(Date.now() / 1000) - 10 * 60;
    const { header } = signWebhookBody(body, secret, oldTs);
    expect(verifyWebhookSignature(body, header, secret)).toBe(false);
  });
});
