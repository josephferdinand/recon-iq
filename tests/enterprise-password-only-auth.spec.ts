import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const authSources = ["src/routes/auth.tsx", "src/routes/t.$slug.auth.tsx"].map((file) => ({
  file,
  source: readFileSync(file, "utf8"),
}));

describe("enterprise password-only authentication", () => {
  it.each(authSources)("removes third-party sign-in from $file", ({ source }) => {
    expect(source).not.toContain("signInWithOAuth");
    expect(source).not.toContain("listAuthProviders");
    expect(source).not.toContain("googleEnabled");
    expect(source).not.toMatch(/>\s*Google\s*</u);
    expect(source).not.toContain("or continue with");
  });

  it("removes public self-signup from the platform sign-in route", () => {
    const source = authSources.find(({ file }) => file === "src/routes/auth.tsx")?.source ?? "";

    expect(source).not.toContain("supabase.auth.signUp");
    expect(source).not.toContain('setMode("signup")');
    expect(source).not.toContain("Request Access");
  });
});
