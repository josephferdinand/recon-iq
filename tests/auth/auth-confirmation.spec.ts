import { describe, expect, it } from "vitest";

import { isSupportedEmailOtpType, safeConfirmationDestination } from "@/lib/auth-confirmation";

describe("auth confirmation interstitial", () => {
  it("recognizes only supported Supabase email OTP types", () => {
    expect(isSupportedEmailOtpType("recovery")).toBe(true);
    expect(isSupportedEmailOtpType("invite")).toBe(true);
    expect(isSupportedEmailOtpType("unknown")).toBe(false);
  });

  it("always sends recovery to the new-password page", () => {
    expect(
      safeConfirmationDestination(
        "recovery",
        "https://dev.app.reconiq.example/elsewhere",
        "https://dev.app.reconiq.example",
      ),
    ).toBe("/reset-password");
  });

  it("allows only same-origin post-verification destinations", () => {
    expect(
      safeConfirmationDestination(
        "invite",
        "https://dev.app.reconiq.example/onboarding?step=1",
        "https://dev.app.reconiq.example",
      ),
    ).toBe("/onboarding?step=1");
    expect(
      safeConfirmationDestination(
        "invite",
        "https://hostile.example/steal",
        "https://dev.app.reconiq.example",
      ),
    ).toBe("/home");
  });
});
