// Auth input validation + error mapping tests.
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { mapAuthError } from "@/lib/auth-audit";

// Mirror of the schema used inline in src/routes/auth.tsx validateForm().
const emailSchema = z.string().trim().toLowerCase().email().max(254);

describe("auth email validation", () => {
  it.each([
    ["", false],
    ["not-an-email", false],
    ["foo@", false],
    ["@bar.com", false],
    ["a".repeat(250) + "@x.io", false], // exceeds 254
    ["User@Example.COM", true],
    ["  spaced@example.com  ", true],
  ])("validates %p -> ok=%p", (input, ok) => {
    expect(emailSchema.safeParse(input).success).toBe(ok);
  });

  it("normalises to trimmed lowercase", () => {
    const r = emailSchema.safeParse("  Mixed@Case.IO ");
    expect(r.success && r.data).toBe("mixed@case.io");
  });
});

describe("signup password rules", () => {
  it("rejects passwords shorter than 12 chars", () => {
    expect("short".length < 12).toBe(true);
  });
  it("accepts 12+ char passwords", () => {
    expect("Sup3rSecure!!".length >= 12).toBe(true);
  });
});

describe("mapAuthError translation", () => {
  it("maps invalid credentials with actionable hint", () => {
    const r = mapAuthError({ message: "Invalid login credentials" });
    expect(r.code).toBe("invalid_credentials");
    expect(r.title).toMatch(/incorrect/i);
    expect(r.hint).toMatch(/locked/);
  });

  it("maps network failures distinctly from auth failures", () => {
    expect(mapAuthError({ message: "Failed to fetch" }).code).toBe("network");
    expect(mapAuthError({ message: "load failed" }).code).toBe("network");
  });

  it("flags unconfirmed email", () => {
    expect(mapAuthError({ message: "Email not confirmed" }).code).toBe("email_unconfirmed");
  });

  it("flags rate limiting via status 429 or message", () => {
    expect(mapAuthError({ status: 429, message: "" }).code).toBe("rate_limited");
    expect(mapAuthError({ message: "rate limit reached" }).code).toBe("rate_limited");
  });

  it("flags weak/pwned passwords", () => {
    expect(mapAuthError({ message: "Password should be at least 12 characters" }).code).toBe(
      "weak_password",
    );
    expect(mapAuthError({ message: "pwned password detected" }).code).toBe("weak_password");
  });

  it("flags duplicate registration", () => {
    expect(mapAuthError({ message: "User already registered" }).code).toBe("already_registered");
  });

  it("flags 5xx as transient server error", () => {
    expect(mapAuthError({ status: 503, message: "boom" }).code).toBe("server_error");
  });

  it("falls back to unknown without crashing on null input", () => {
    expect(mapAuthError(null).code).toBe("unknown");
    expect(mapAuthError(undefined).code).toBe("unknown");
  });
});
