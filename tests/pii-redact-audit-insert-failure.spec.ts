// Focused regression: redactAndAudit MUST return the redacted text even if
// the audit insert throws. This is the fail-open guarantee for the LLM
// gateway path — a DB outage must NOT block the user-visible request.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { redactAndAudit } from "@/lib/pii-redact";

describe("redactAndAudit — insert failure resilience", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { errSpy = vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => { errSpy.mockRestore(); });

  it("returns redacted text and does not throw when supabase.from().insert() throws", async () => {
    const insertFn = vi.fn(async () => {
      throw new Error("simulated DB outage");
    });
    const supabase = {
      from: vi.fn(() => ({ insert: insertFn })),
    };

    const input = "wire to alice@example.com from card 4111 1111 1111 1111";
    const out = await redactAndAudit(input, {
      supabase,
      tenantId: "00000000-0000-0000-0000-000000000099",
      callerId: "00000000-0000-0000-0000-000000000088",
      destination: "agent",
    });

    expect(out).toContain("[REDACTED_EMAIL]");
    expect(out).toContain("[REDACTED_CARD]");
    expect(out).not.toContain("alice@example.com");
    expect(insertFn).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalled();
  });

  it("returns redacted text when supabase.from().insert() returns an error object", async () => {
    const insertFn = vi.fn(async () => ({ error: { message: "permission denied" } }));
    const supabase = { from: vi.fn(() => ({ insert: insertFn })) };

    const out = await redactAndAudit("ping bob@example.com", {
      supabase,
      tenantId: "00000000-0000-0000-0000-000000000099",
      callerId: "00000000-0000-0000-0000-000000000088",
      destination: "copilot",
    });
    expect(out).toContain("[REDACTED_EMAIL]");
  });

  it("returns redacted text when the unattributed security_events write throws", async () => {
    const insertFn = vi.fn(async () => { throw new Error("security_events down"); });
    const supabase = { from: vi.fn(() => ({ insert: insertFn })) };

    const out = await redactAndAudit("ssn 123-45-6789", {
      supabase,
      tenantId: null,
      callerId: "00000000-0000-0000-0000-000000000088",
      destination: "copilot",
    });
    expect(out).toContain("[REDACTED_SSN]");
    expect(supabase.from).toHaveBeenCalledWith("security_events");
  });
});
