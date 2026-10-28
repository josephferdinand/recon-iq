import { describe, expect, it } from "vitest";
import { requiresMfaChallenge, safePostMfaRedirect } from "@/lib/mfa-assurance";

describe("MFA assurance routing", () => {
  it("requires AAL2 whenever a verified factor makes it the next level", () => {
    expect(requiresMfaChallenge({ currentLevel: "aal1", nextLevel: "aal2" })).toBe(true);
    expect(requiresMfaChallenge({ currentLevel: "aal2", nextLevel: "aal2" })).toBe(false);
    expect(requiresMfaChallenge({ currentLevel: "aal1", nextLevel: "aal1" })).toBe(false);
  });

  it("accepts only same-origin relative post-MFA destinations", () => {
    expect(safePostMfaRedirect("/tenant/workspace?page=dashboard")).toBe("/tenant/workspace?page=dashboard");
    expect(safePostMfaRedirect("https://attacker.example")).toBe("/home");
    expect(safePostMfaRedirect("//attacker.example")).toBe("/home");
  });

  it("keeps the password form as the one route that performs its own current-password plus MFA gate", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) =>
      readFile("src/routes/_authenticated/route.tsx", "utf8"),
    );
    expect(source).toContain('location.pathname !== "/profile/security"');
  });
});
