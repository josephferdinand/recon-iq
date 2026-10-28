import { describe, expect, it } from "vitest";
import { signupRedirectOrigin } from "@/lib/signup-admission.functions";

describe("signup verification redirect environment", () => {
  it("keeps PROD and DEV invitation links in their issuing environment", () => {
    expect(signupRedirectOrigin("YOUR_PROJECT_REF")).toBe("https://app.reconiq.example");
    expect(signupRedirectOrigin("YOUR_PROJECT_REF")).toBe("https://dev.app.reconiq.example");
  });

  it("fails closed for an unknown project", () => {
    expect(() => signupRedirectOrigin("unknown")).toThrow("Signup environment is unavailable");
  });
});
