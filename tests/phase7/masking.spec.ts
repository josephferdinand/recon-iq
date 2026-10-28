import { describe, it, expect } from "vitest";
import { applyMask } from "@/lib/phase7-drift-masking.functions";

describe("applyMask", () => {
  it("redacts to bullet characters of bounded length", () => {
    expect(applyMask("hello", "redact")).toBe("•••••");
    expect(applyMask("verylongstring", "redact")).toBe("••••••••");
  });
  it("preserves last4", () => {
    expect(applyMask("4242424242424242", "last4")).toBe("****4242");
    expect(applyMask("12", "last4")).toBe("****");
  });
  it("preserves @domain for email_local", () => {
    expect(applyMask("alice@example.com", "email_local")).toBe("****@example.com");
    expect(applyMask("not-an-email", "email_local")).toBe("****");
  });
  it("hashes deterministically with sha prefix", () => {
    const a = applyMask("abc", "hash");
    const b = applyMask("abc", "hash");
    expect(a).toBe(b);
    expect(String(a).startsWith("sha:")).toBe(true);
  });
  it("nulls when asked", () => {
    expect(applyMask("anything", "null")).toBeNull();
  });
  it("truncates to 3-char prefix + ellipsis", () => {
    expect(applyMask("hello", "truncate")).toBe("hel…");
    expect(applyMask("4242424242424242", "truncate")).toBe("424…");
    expect(applyMask("ab", "truncate")).toBe("ab…");
  });
  it("passes through null/undefined", () => {
    expect(applyMask(null, "redact")).toBeNull();
    expect(applyMask(undefined, "hash")).toBeUndefined();
  });
});
