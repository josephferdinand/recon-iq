export const PROFILE_PASSWORD_MIN_LENGTH = 12;

export type PasswordChangeFailureCode =
  | "validation"
  | "identity"
  | "reauthentication"
  | "mfa_required"
  | "mfa_verification"
  | "update";

export class PasswordChangeFailure extends Error {
  constructor(
    public readonly code: PasswordChangeFailureCode,
    message: string,
    public readonly authError?: unknown,
  ) {
    super(message);
    this.name = "PasswordChangeFailure";
  }
}

/** Return only a fixed failure category for logs and security-event context. */
export function safePasswordChangeFailureCode(
  error: unknown,
): PasswordChangeFailureCode | "unknown" {
  return error instanceof PasswordChangeFailure ? error.code : "unknown";
}

type AuthUser = { id: string; email?: string | null };

export interface ProfilePasswordAuthClient {
  getUser(): Promise<{ data: { user: AuthUser | null }; error?: unknown }>;
  signInWithPassword(credentials: { email: string; password: string }): Promise<{
    data: { user: AuthUser | null; session: unknown | null };
    error: unknown | null;
  }>;
  updateUser(attributes: { password: string }): Promise<{
    data: { user: AuthUser | null };
    error: unknown | null;
  }>;
  signOut(options: { scope: "others" }): Promise<{ error: unknown | null }>;
  mfa: {
    getAuthenticatorAssuranceLevel(): Promise<{
      data: { currentLevel: string | null; nextLevel: string | null } | null;
      error: unknown | null;
    }>;
    listFactors(): Promise<{
      data: { all: Array<{ id: string; status: string; factor_type: string }> } | null;
      error: unknown | null;
    }>;
    challengeAndVerify(input: { factorId: string; code: string }): Promise<{
      data: unknown;
      error: unknown | null;
    }>;
  };
}

export interface ProfilePasswordChangeInput {
  currentPassword: string;
  newPassword: string;
  confirmation: string;
  signOutOthers: boolean;
  mfaCode?: string;
}

export interface ProfilePasswordChangeResult {
  user: AuthUser;
  otherSessionsRevoked: boolean;
  revocationError?: unknown;
}

export interface ProfilePasswordVerification {
  reauthenticate: ProfilePasswordAuthClient["signInWithPassword"];
  verifyMfa: ProfilePasswordAuthClient["mfa"]["challengeAndVerify"];
}

export function validateProfilePasswordChange(input: ProfilePasswordChangeInput): void {
  if (!input.currentPassword) {
    throw new PasswordChangeFailure("validation", "Enter your current password.");
  }
  if (input.newPassword.length < PROFILE_PASSWORD_MIN_LENGTH) {
    throw new PasswordChangeFailure(
      "validation",
      `Password must be at least ${PROFILE_PASSWORD_MIN_LENGTH} characters.`,
    );
  }
  if (input.newPassword === input.currentPassword) {
    throw new PasswordChangeFailure(
      "validation",
      "Your new password must be different from your current password.",
    );
  }
  if (input.newPassword !== input.confirmation) {
    throw new PasswordChangeFailure("validation", "Passwords do not match.");
  }
}

/**
 * Re-authenticate the active browser session, update the password through that
 * fresh session, and optionally revoke every other Supabase refresh session.
 */
export async function changeProfilePassword(
  auth: ProfilePasswordAuthClient,
  input: ProfilePasswordChangeInput,
  verification?: ProfilePasswordVerification,
): Promise<ProfilePasswordChangeResult> {
  validateProfilePasswordChange(input);

  const identity = await auth.getUser();
  const user = identity.data.user;
  const email = user?.email;
  if (identity.error || !user || !email) {
    throw new PasswordChangeFailure(
      "identity",
      "Could not determine your current account. Please sign in again.",
      identity.error,
    );
  }

  // signInWithPassword intentionally refreshes the browser client session.
  // updateUser must use this newly authenticated session, not the stale one.
  const reauthenticated = await (verification?.reauthenticate ?? ((credentials) => auth.signInWithPassword(credentials)))({
    email,
    password: input.currentPassword,
  });
  if (reauthenticated.error || !reauthenticated.data.session) {
    throw new PasswordChangeFailure(
      "reauthentication",
      "Current password could not be verified.",
      reauthenticated.error,
    );
  }
  if (reauthenticated.data.user?.id !== user.id) {
    throw new PasswordChangeFailure("identity", "The current account could not be verified. Please sign in again.");
  }

  const assurance = await auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error || !assurance.data) {
    throw new PasswordChangeFailure(
      "mfa_verification",
      "Could not verify your multi-factor status.",
      assurance.error,
    );
  }
  if (assurance.data.nextLevel === "aal2" && assurance.data.currentLevel !== "aal2") {
    if (!/^\d{6}$/u.test(input.mfaCode ?? "")) {
      throw new PasswordChangeFailure("mfa_required", "Enter your six-digit authenticator code.");
    }
    const listed = await auth.mfa.listFactors();
    const factor = listed.data?.all.find(
      (candidate) => candidate.status === "verified" && candidate.factor_type === "totp",
    );
    if (listed.error || !factor) {
      throw new PasswordChangeFailure(
        "mfa_verification",
        "No verified login authenticator is available.",
        listed.error,
      );
    }
    const verified = await (verification?.verifyMfa ?? ((challenge) => auth.mfa.challengeAndVerify(challenge)))({
      factorId: factor.id,
      code: input.mfaCode!,
    });
    if (verified.error) {
      throw new PasswordChangeFailure(
        "mfa_verification",
        "The authenticator code is invalid or expired.",
        verified.error,
      );
    }
    if (verification && (!verified.data || typeof verified.data !== "object" || !("user" in verified.data)
      || !verified.data.user || typeof verified.data.user !== "object" || !("id" in verified.data.user) || verified.data.user.id !== user.id)) {
      throw new PasswordChangeFailure("identity", "The current account could not be verified. Please sign in again.");
    }
  }

  const updated = await auth.updateUser({ password: input.newPassword });
  if (updated.error || !updated.data.user) {
    throw new PasswordChangeFailure("update", "Could not update password.", updated.error);
  }

  if (!input.signOutOthers) {
    return { user: updated.data.user, otherSessionsRevoked: false };
  }

  const revoked = await auth.signOut({ scope: "others" });
  return revoked.error
    ? { user: updated.data.user, otherSessionsRevoked: false, revocationError: revoked.error }
    : { user: updated.data.user, otherSessionsRevoked: true };
}
