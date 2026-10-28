import { describe, it, expect, vi } from "vitest";
import { assertChatopsEnv } from "@/lib/chatops-env.server";

describe("S-6 chat-ops env validation", () => {
  it("throws when SLACK_SIGNING_SECRET missing in production", () => {
    expect(() => assertChatopsEnv("SLACK_SIGNING_SECRET", undefined, "production")).toThrow(
      /SLACK_SIGNING_SECRET/,
    );
  });

  it("throws when INBOUND_EMAIL_SECRET missing in production", () => {
    expect(() => assertChatopsEnv("INBOUND_EMAIL_SECRET", "", "production")).toThrow(
      /INBOUND_EMAIL_SECRET/,
    );
  });

  it("warns (does not throw) in development when missing", () => {
    const warn = vi.fn();
    expect(() => assertChatopsEnv("SLACK_SIGNING_SECRET", undefined, "development", { warn })).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/SLACK_SIGNING_SECRET/);
  });

  it("does nothing when env var is present in production", () => {
    const warn = vi.fn();
    expect(() => assertChatopsEnv("SLACK_SIGNING_SECRET", "real-secret", "production", { warn })).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it("does nothing when env var is present in dev", () => {
    const warn = vi.fn();
    expect(() => assertChatopsEnv("INBOUND_EMAIL_SECRET", "real-secret", "development", { warn })).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});
