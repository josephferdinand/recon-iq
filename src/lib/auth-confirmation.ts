export const SUPPORTED_EMAIL_OTP_TYPES = [
  "email",
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
] as const;

export type SupportedEmailOtpType = (typeof SUPPORTED_EMAIL_OTP_TYPES)[number];

export function isSupportedEmailOtpType(value: string): value is SupportedEmailOtpType {
  return (SUPPORTED_EMAIL_OTP_TYPES as readonly string[]).includes(value);
}

export function safeConfirmationDestination(
  type: SupportedEmailOtpType,
  redirectTo: string | undefined,
  currentOrigin: string,
): string {
  if (type === "recovery") return "/reset-password";

  if (redirectTo) {
    try {
      const target = new URL(redirectTo, currentOrigin);
      if (target.origin === currentOrigin) {
        return `${target.pathname}${target.search}${target.hash}`;
      }
    } catch {
      // Fall through to the trusted destination.
    }
  }

  return type === "email_change" ? "/profile" : "/home";
}
