/**
 * Lightweight, best-effort client-side audit hook for authentication events.
 * Server persists into `security_events` (see /api/public/security-event).
 * Never throws — never blocks the auth flow.
 */
export type AuthAuditEvent =
  | "auth.failed_login"
  | "auth.success_login"
  | "auth.logout"
  | "auth.password_reset_requested"
  | "auth.password_reset_failed"
  | "auth.password_reset_completed"
  | "auth.signup_failed"
  | "auth.signup_success"
  | "auth.mfa_failed"
  | "auth.mfa_verified"
  | "auth.mfa_enroll_failed";

export function reportAuthEvent(
  event_type: AuthAuditEvent,
  payload: { email?: string; user_id?: string; context?: Record<string, unknown> } = {},
): void {
  try {
    void fetch("/api/public/security-event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event_type,
        email: payload.email,
        user_id: payload.user_id,
        context: payload.context ?? {},
      }),
      keepalive: true,
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Map Supabase auth errors to actionable, user-friendly messages.
 * Returns { title, hint } so the UI can render an inline alert.
 */
export function mapAuthError(raw: unknown): { title: string; hint?: string; code: string } {
  const err =
    raw && typeof raw === "object"
      ? (raw as {
          message?: unknown;
          error_description?: unknown;
          status?: unknown;
          statusCode?: unknown;
        })
      : {};
  const msg = String(err.message ?? err.error_description ?? raw ?? "").toLowerCase();
  const rawStatus = err.status ?? err.statusCode;
  const status = typeof rawStatus === "number" ? rawStatus : undefined;

  if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("load failed")) {
    return {
      code: "network",
      title: "Can't reach the sign-in service",
      hint: "Check your internet connection and try again. If you're on a VPN or corporate network, your admin may need to allow access.",
    };
  }
  if (msg.includes("invalid login credentials") || msg.includes("invalid_grant")) {
    return {
      code: "invalid_credentials",
      title: "Email or password is incorrect",
      hint: "Double-check your email and password. After 5 failed attempts your account is briefly locked for security.",
    };
  }
  if (msg.includes("email not confirmed")) {
    return {
      code: "email_unconfirmed",
      title: "Confirm your email first",
      hint: "We sent a confirmation link to your email. Click it, then try signing in again.",
    };
  }
  if (msg.includes("rate") || status === 429) {
    return {
      code: "rate_limited",
      title: "Too many attempts",
      hint: "For your security we've paused sign-in attempts. Please wait a minute and try again.",
    };
  }
  if (msg.includes("user not found")) {
    return {
      code: "user_not_found",
      title: "No account for this email",
      hint: "Check the spelling, or contact your tenant admin for an invitation.",
    };
  }
  if (
    msg.includes("password should be at least") ||
    msg.includes("weak password") ||
    msg.includes("pwned")
  ) {
    return {
      code: "weak_password",
      title: "Choose a stronger password",
      hint: "Use 12+ characters with a mix of upper, lower, numbers and symbols — and avoid passwords that have appeared in known breaches.",
    };
  }
  if (msg.includes("already registered") || msg.includes("user already")) {
    return {
      code: "already_registered",
      title: "This email already has an account",
      hint: "Try signing in instead, or use the password-reset link below.",
    };
  }
  if (status && status >= 500) {
    return {
      code: "server_error",
      title: "Sign-in service is temporarily unavailable",
      hint: "We're working on it. Please try again in a moment.",
    };
  }
  return {
    code: "unknown",
    title: typeof err.message === "string" ? err.message : "Sign-in failed",
    hint: "Please try again. If the problem persists, contact your administrator.",
  };
}
