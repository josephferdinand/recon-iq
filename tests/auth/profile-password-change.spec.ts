import { describe, expect, it, vi } from "vitest";

import {
  PasswordChangeFailure,
  changeProfilePassword,
  safePasswordChangeFailureCode,
  validateProfilePasswordChange,
} from "@/lib/profile-password-change";

const user = { id: "00000000-0000-4000-8000-000000000001", email: "owner@example.test" };

function authMock(overrides: Record<string, unknown> = {}) {
  return {
    getUser: vi.fn(async () => ({ data: { user }, error: null })),
    signInWithPassword: vi.fn(async () => ({
      data: { user, session: { access_token: "test" } },
      error: null,
    })),
    updateUser: vi.fn(async () => ({ data: { user }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    mfa: {
      getAuthenticatorAssuranceLevel: vi.fn(async () => ({
        data: { currentLevel: "aal1" as const, nextLevel: "aal1" as const },
        error: null,
      })),
      listFactors: vi.fn(async () => ({ data: { all: [] }, error: null })),
      challengeAndVerify: vi.fn(async () => ({ data: {}, error: null })),
    },
    ...overrides,
  };
}

const validInput = {
  currentPassword: "CurrentPassword!234",
  newPassword: "DifferentPassword!567",
  confirmation: "DifferentPassword!567",
  signOutOthers: true,
};

describe("profile password change", () => {
  it("keeps provider exception text and submitted secrets out of failure telemetry", () => {
    const secret = "secret-password-and-provider-detail";
    expect(safePasswordChangeFailureCode(new PasswordChangeFailure("update", secret))).toBe("update");
    expect(safePasswordChangeFailureCode(new Error(secret))).toBe("unknown");
  });

  it("rejects incomplete, reused, short, and mismatched passwords before auth calls", () => {
    expect(() => validateProfilePasswordChange({ ...validInput, currentPassword: "" })).toThrow(
      "current password",
    );
    expect(() =>
      validateProfilePasswordChange({ ...validInput, newPassword: "short", confirmation: "short" }),
    ).toThrow("at least 12");
    expect(() =>
      validateProfilePasswordChange({
        ...validInput,
        newPassword: validInput.currentPassword,
        confirmation: validInput.currentPassword,
      }),
    ).toThrow("different");
    expect(() =>
      validateProfilePasswordChange({ ...validInput, confirmation: "MismatchPassword!890" }),
    ).toThrow("do not match");
  });

  it("uses the freshly re-authenticated session before updating the password", async () => {
    const auth = authMock();
    const result = await changeProfilePassword(auth, validInput);

    expect(auth.getUser).toHaveBeenCalledOnce();
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: user.email,
      password: validInput.currentPassword,
    });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: validInput.newPassword });
    expect(auth.signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(
      auth.updateUser.mock.invocationCallOrder[0],
    );
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(result.otherSessionsRevoked).toBe(true);
  });

  it("stops before update when current-password verification fails", async () => {
    const auth = authMock({
      signInWithPassword: vi.fn(async () => ({
        data: { user: null, session: null },
        error: { code: "invalid_credentials" },
      })),
    });

    await expect(changeProfilePassword(auth, validInput)).rejects.toMatchObject<
      Partial<PasswordChangeFailure>
    >({
      code: "reauthentication",
    });
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("keeps a successful password update truthful when other-session revocation fails", async () => {
    const revocationError = { message: "network unavailable" };
    const auth = authMock({ signOut: vi.fn(async () => ({ error: revocationError })) });
    const result = await changeProfilePassword(auth, validInput);

    expect(result.user.id).toBe(user.id);
    expect(result.otherSessionsRevoked).toBe(false);
    expect(result.revocationError).toBe(revocationError);
  });

  it("does not revoke sessions when the owner leaves the option disabled", async () => {
    const auth = authMock();
    const result = await changeProfilePassword(auth, { ...validInput, signOutOthers: false });

    expect(auth.signOut).not.toHaveBeenCalled();
    expect(result.otherSessionsRevoked).toBe(false);
    expect(result.revocationError).toBeUndefined();
  });

  it("requires and verifies a TOTP code after password reauthentication when AAL2 is available", async () => {
    const auth = authMock();
    auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    });
    auth.mfa.listFactors.mockResolvedValue({
      data: { all: [{ id: "factor-1", status: "verified", factor_type: "totp" }] },
      error: null,
    });

    await expect(changeProfilePassword(auth, validInput)).rejects.toMatchObject({ code: "mfa_required" });
    expect(auth.updateUser).not.toHaveBeenCalled();

    await changeProfilePassword(auth, { ...validInput, mfaCode: "123456" });
    expect(auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: "factor-1", code: "123456" });
    expect(auth.mfa.challengeAndVerify.mock.invocationCallOrder[0]).toBeLessThan(
      auth.updateUser.mock.invocationCallOrder[0],
    );
  });
});
