/** Stable, user-facing copy. Never interpolate an exception or API response. */
export const USER_FACING_ERRORS = {
  unexpected: {
    title: "Something Didn't Go As Planned",
    message: "We encountered an unexpected issue while processing your request.",
    action: "Please try again in a few moments. If the issue continues, contact support.",
  },
  service: {
    title: "Unable To Reach The Service",
    message: "The requested service is currently unavailable.",
    action: "Please try again shortly. If the issue continues, contact support.",
  },
  network: {
    title: "Connection Interrupted",
    message: "We were unable to establish a connection.",
    action: "Please check your internet connection and try again.",
  },
  validation: {
    title: "Information Needs Attention",
    message: "Some information in this request could not be accepted.",
    action: "Review the highlighted fields and try again.",
  },
  access: {
    title: "You Don't Currently Have Access",
    message: "Your account does not currently have permission to access this area.",
    action: "Contact your administrator if you believe access should be granted.",
  },
  record: {
    title: "Record Unavailable",
    message: "This record could not be displayed or is outside your permitted scope.",
    action: "Check the selection or contact your administrator if you believe this is incorrect.",
  },
  session: {
    title: "Session Expired",
    message: "For security reasons, your session is no longer active.",
    action: "Please sign in again to continue.",
  },
} as const;

export function userFacingErrorKind(error: unknown): keyof typeof USER_FACING_ERRORS {
  const detail = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = Number(detail.status ?? detail.statusCode);
  const code = typeof detail.code === "string" ? detail.code : "";
  if (status === 401) return "session";
  if (status === 403 || code === "42501") return "access";
  if (status === 400 || status === 422) return "validation";
  if (status === 404) return "record";
  if (status === 502 || status === 503 || status === 504 || code === "PGRST002" || code === "PGRST003") return "service";
  if (error instanceof TypeError && Number.isNaN(status)) return "network";
  return "unexpected";
}

/** A short correlation code, not a database UUID or a credential. */
export function createErrorReference(): string {
  const bytes = new Uint8Array(6);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return `FVI-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

export function safeErrorPayload(referenceId: string, status = 500) {
  const category = status === 400 || status === 422 ? "validation"
    : status === 401 ? "session"
      : status === 403 ? "access"
        : status === 404 ? "record"
          : status === 429 || status === 502 || status === 503 || status === 504 ? "service"
            : "unexpected";
  const copy = USER_FACING_ERRORS[category];
  return {
    error: category === "unexpected" ? "internal_server_error" : category,
    title: copy.title,
    message: copy.message,
    action: copy.action,
    reference_id: referenceId,
  };
}
