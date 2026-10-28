export type RecoveryCallbackKind = "code" | "tokens" | "error" | "none";

export interface ParsedRecoveryCallback {
  kind: RecoveryCallbackKind;
  code?: string;
  flowId?: string;
  accessToken?: string;
  refreshToken?: string;
  errorDescription?: string;
  isRecovery: boolean;
}

type SessionResult = {
  data: { session: unknown | null };
  error: unknown | null;
};

export interface RecoveryAuthClient {
  getSession(): Promise<SessionResult>;
  exchangeCodeForSession(code: string, options?: { flowId: string }): Promise<SessionResult>;
  setSession(tokens: { access_token: string; refresh_token: string }): Promise<SessionResult>;
}

export class RecoveryCallbackError extends Error {
  constructor(
    message: string,
    public readonly causeDetail?: unknown,
  ) {
    super(message);
    this.name = "RecoveryCallbackError";
  }
}

function firstValue(...values: Array<string | null>): string | undefined {
  return values.find((value): value is string => Boolean(value));
}

export function parseRecoveryCallback(urlValue: string): ParsedRecoveryCallback {
  const url = new URL(urlValue);
  const query = url.searchParams;
  const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const type = firstValue(query.get("type"), hash.get("type"));
  const errorDescription = firstValue(
    query.get("error_description"),
    hash.get("error_description"),
    query.get("error"),
    hash.get("error"),
  );

  if (errorDescription) {
    return { kind: "error", errorDescription, isRecovery: type === "recovery" };
  }

  const code = query.get("code");
  if (code) {
    return {
      kind: "code",
      code,
      flowId: query.get("sb_flow_id") ?? undefined,
      isRecovery: type === "recovery" || query.has("code"),
    };
  }

  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (accessToken && refreshToken) {
    return {
      kind: "tokens",
      accessToken,
      refreshToken,
      isRecovery: type === "recovery",
    };
  }

  return { kind: "none", isRecovery: type === "recovery" };
}

export function cleanRecoveryCallbackUrl(urlValue: string): string {
  const url = new URL(urlValue);
  for (const name of ["code", "sb_flow_id", "type", "error", "error_code", "error_description"]) {
    url.searchParams.delete(name);
  }
  url.hash = "";
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}`;
}

/** Establish a recovery session for implicit-token and PKCE callbacks. */
export async function establishRecoverySession(
  auth: RecoveryAuthClient,
  urlValue: string,
): Promise<{ session: unknown | null; callback: ParsedRecoveryCallback }> {
  const callback = parseRecoveryCallback(urlValue);

  if (callback.kind === "error") {
    throw new RecoveryCallbackError(
      callback.errorDescription ?? "The recovery link is invalid or expired.",
    );
  }

  if (callback.kind === "code" && callback.code) {
    const result = await auth.exchangeCodeForSession(
      callback.code,
      callback.flowId ? { flowId: callback.flowId } : undefined,
    );
    if (result.error || !result.data.session) {
      throw new RecoveryCallbackError(
        "The recovery code could not be exchanged. Request a new password-reset email.",
        result.error,
      );
    }
    return { session: result.data.session, callback };
  }

  if (callback.kind === "tokens" && callback.accessToken && callback.refreshToken) {
    const result = await auth.setSession({
      access_token: callback.accessToken,
      refresh_token: callback.refreshToken,
    });
    if (result.error || !result.data.session) {
      throw new RecoveryCallbackError(
        "The recovery session could not be established. Request a new password-reset email.",
        result.error,
      );
    }
    return { session: result.data.session, callback };
  }

  const existing = await auth.getSession();
  if (existing.error) {
    throw new RecoveryCallbackError("The recovery session could not be validated.", existing.error);
  }
  return { session: existing.data.session, callback };
}
