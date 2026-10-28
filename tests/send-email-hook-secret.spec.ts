import { describe, expect, it } from "vitest";

import { normalizeWebhookSecret } from "../supabase/functions/send-email/webhook-secret";

describe("Supabase send-email hook secret", () => {
  it("removes the Supabase version selector and preserves the webhook secret", () => {
    expect(normalizeWebhookSecret("v1,whsec_dGVzdA==")).toBe("whsec_dGVzdA==");
  });

  it("preserves standard and raw secrets", () => {
    expect(normalizeWebhookSecret("whsec_dGVzdA==")).toBe("whsec_dGVzdA==");
    expect(normalizeWebhookSecret("dGVzdA==")).toBe("dGVzdA==");
  });
});
