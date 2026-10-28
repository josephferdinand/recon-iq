export const failedLoginOutcomes = [
  "invalid_credentials", "mfa_invalid", "mfa_expired", "account_locked",
  "rate_limited", "policy_blocked", "provider_unavailable", "verification_failed",
] as const;
export type FailedLoginOutcome = (typeof failedLoginOutcomes)[number];
export type LoginStage = "password" | "mfa" | "policy";

// Only provider codes/status enter classification. Never include provider messages.
export function failedLoginOutcome(error: { code?: string; status?: number }, stage: LoginStage): FailedLoginOutcome {
  if (error.status === 429 || error.code === "over_request_rate_limit") return "rate_limited";
  if (error.code === "user_banned") return "account_locked";
  if (stage === "mfa" && error.code === "mfa_verification_failed") return "mfa_invalid";
  if (stage === "mfa" && error.code === "mfa_challenge_expired") return "mfa_expired";
  if (stage === "password" && error.code === "invalid_credentials") return "invalid_credentials";
  if (!error.status || error.status >= 500) return "provider_unavailable";
  return "verification_failed";
}

export function publicLoginError(outcome: FailedLoginOutcome): { message: string; code: string; status: number; hint?: string } {
  if (outcome === "invalid_credentials") return { message: "Invalid login credentials", code: outcome, status: 400, hint: "Check your email and password, or use Forgot Password to request a recovery link." };
  if (outcome === "rate_limited") return { message: "Too many sign-in attempts. Please wait and try again.", code: outcome, status: 429 };
  if (outcome === "provider_unavailable") return { message: "Sign-in service is temporarily unavailable", code: outcome, status: 503 };
  if (outcome === "mfa_invalid" || outcome === "mfa_expired") return { message: "That authentication code is invalid or expired.", code: outcome, status: 400 };
  // Unknown account, unverified account and provider-specific account states must
  // not turn this endpoint into a public account directory.
  return { message: "Sign-in could not be completed. Try again or contact your administrator.", code: "verification_failed", status: 400 };
}

export const failedLoginDescriptions: Record<FailedLoginOutcome, string> = {
  invalid_credentials: "The sign-in service rejected the credentials.",
  mfa_invalid: "The sign-in service rejected the authenticator code.",
  mfa_expired: "The authenticator challenge had expired.",
  account_locked: "The sign-in service denied access because the account is locked or restricted.",
  rate_limited: "The sign-in service paused the attempt because its rate limit was reached.",
  policy_blocked: "Your organization's current access policy blocked the sign-in.",
  provider_unavailable: "The sign-in could not be completed because the sign-in service was unavailable. The credential result is unknown.",
  verification_failed: "The sign-in service could not complete verification. No specific credential mismatch was confirmed.",
};

export function canonicalFailedLoginOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || !["app.reconiq.example", "dev.app.reconiq.example"].includes(url.hostname)
    || url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Failed-login email canonical origin unavailable");
  }
  return url.origin;
}
