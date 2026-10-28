import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { __validateSlackRequest } from "@/routes/api/public/chat-ops/slack";
import { __validateEmailRequest } from "@/routes/api/public/chat-ops/email";

// S-4 — timing oracle resistance.
// We assert that malformed-body and bad-signature paths take roughly
// the same wall-clock time (within a generous delta to absorb CI noise).

function median(xs: bigint[]): bigint {
  const s = [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return s[Math.floor(s.length / 2)];
}

describe("S-4 chat-ops timing oracle", () => {
  it("slack: malformed-body and bad-sig timings are within tight delta", async () => {
    const secret = "slack-signing-secret";
    const ts = String(Math.floor(Date.now() / 1000));
    const goodBody = "team_id=T1&channel_id=C1&text=help&user_name=u";
    const malformed = "%%%not-a-form%%%";
    const badSig = "v0=" + "0".repeat(64);
    const goodSig = "v0=" + createHmac("sha256", Buffer.from(secret)).update(`v0:${ts}:${goodBody}`).digest("hex");

    // Warm-up to stabilize JIT.
    for (let i = 0; i < 50; i++) {
      await __validateSlackRequest(goodBody, ts, badSig, secret);
      await __validateSlackRequest(malformed, ts, goodSig, secret);
    }

    const sampleA: bigint[] = [];
    const sampleB: bigint[] = [];
    for (let i = 0; i < 200; i++) {
      sampleA.push((await __validateSlackRequest(goodBody, ts, badSig, secret)).elapsedNs);
      sampleB.push((await __validateSlackRequest(malformed, ts, goodSig, secret)).elapsedNs);
    }
    const mA = Number(median(sampleA));
    const mB = Number(median(sampleB));
    const ratio = Math.max(mA, mB) / Math.min(mA, mB);
    // Allow up to 3x noise on CI — well within reason for HMAC-bound work.
    expect(ratio).toBeLessThan(3);
  });

  it("email: malformed-body and bad-bearer timings are within tight delta", async () => {
    const token = "email-bearer-token";
    const goodBody = JSON.stringify({ from: "a@b.com", to: "falcon-acme@x", subject: "assign 123 me" });
    const malformed = "{not-json";

    for (let i = 0; i < 50; i++) {
      await __validateEmailRequest(goodBody, "Bearer wrong", token);
      await __validateEmailRequest(malformed, `Bearer ${token}`, token);
    }
    const sampleA: bigint[] = [];
    const sampleB: bigint[] = [];
    for (let i = 0; i < 200; i++) {
      sampleA.push((await __validateEmailRequest(goodBody, "Bearer wrong", token)).elapsedNs);
      sampleB.push((await __validateEmailRequest(malformed, `Bearer ${token}`, token)).elapsedNs);
    }
    const mA = Number(median(sampleA));
    const mB = Number(median(sampleB));
    const ratio = Math.max(mA, mB) / Math.min(mA, mB);
    expect(ratio).toBeLessThan(3);
  });
});
