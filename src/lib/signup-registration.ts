import { z } from "zod";

/** Classifies only Supabase Auth's typed duplicate-email response as an existing account. */
export function classifySignupInviteError(error: unknown): "existing" | "unknown" {
  if (!error || typeof error !== "object") return "unknown";
  const authError = error as { status?: unknown; code?: unknown };
  if (
    authError.status === 422 &&
    (authError.code === "email_exists" || authError.code === "user_already_exists")
  ) {
    return "existing";
  }
  return "unknown";
}

export const signupAttemptSchema = z
  .object({
    attemptId: z.string().uuid(),
    recoveryToken: z.string().regex(/^[a-f0-9]{64}$/),
    email: z.string().trim().toLowerCase().email().max(254),
    full_name: z.string().trim().min(1).max(120),
  })
  .strict();
export const signupInterestSchema = signupAttemptSchema.extend({
  mode: z.enum(["submit", "check"]).default("submit"),
});
export type SignupAttempt = z.infer<typeof signupAttemptSchema>;
export type SignupInterestInput = z.infer<typeof signupInterestSchema>;
export type SignupInterestResult = {
  accepted: boolean;
  outcome: "accepted" | "existing" | "unknown" | "not_sent";
  retryable: boolean;
  code: string;
  status: number;
  requestId?: string;
};
export const signupRecoveryStorageKey = "fvi-signup-recovery-v1";

export function createSignupAttempt(email: string, full_name: string): SignupAttempt {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return signupAttemptSchema.parse({
    attemptId: crypto.randomUUID(),
    email,
    full_name,
    recoveryToken: Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""),
  });
}

export async function signupDigest(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type RecoveryRecord = {
  state: string;
  request_id?: string;
  code?: string;
  status?: number;
  claimed?: boolean;
  lease_id?: string;
};
export type SignupRecoveryDependencies = {
  record(action: string, values: Record<string, unknown>): Promise<RecoveryRecord>;
  preflight(emailHash: string): Promise<{ proceed: boolean; code?: string; status?: number }>;
  invite(): Promise<{ data?: { user?: { id?: string } | null } | null; error: unknown }>;
};

function publicSignupState(row: RecoveryRecord): SignupInterestResult {
  const requestId =
    row.request_id && /^FVI-[A-F0-9]{12}$/.test(row.request_id) ? row.request_id : undefined;
  if (row.state === "accepted")
    return {
      accepted: true,
      outcome: "accepted",
      code: "SIGNUP_INVITE_ACCEPTED",
      status: 200,
      retryable: false,
      requestId,
    };
  if (row.state === "existing")
    return {
      accepted: false,
      outcome: "existing",
      code: "SIGNUP_ACCOUNT_EXISTS",
      status: 409,
      retryable: false,
      requestId,
    };
  if (["reserved", "not_sent"].includes(row.state)) {
    const limited = row.code === "SIGNUP_RATE_LIMITED";
    return {
      accepted: false,
      outcome: "not_sent",
      code: limited ? "SIGNUP_RATE_LIMITED" : "SIGNUP_NOT_STARTED",
      status: limited ? 429 : 503,
      retryable: true,
      requestId,
    };
  }
  return {
    accepted: false,
    outcome: "unknown",
    code: "WRITE_OUTCOME_UNKNOWN",
    status: 503,
    retryable: false,
    requestId,
  };
}

/** Durable per-email claim is the only gate to Auth; status/replay never invokes it. */
export async function recoverableSignupInterest(
  input: SignupInterestInput,
  deps: SignupRecoveryDependencies,
): Promise<SignupInterestResult> {
  const values = {
    _attempt_id: input.attemptId,
    _email_hash: await signupDigest(input.email),
    _payload_hash: await signupDigest(JSON.stringify([input.email, input.full_name])),
    _recovery_hash: await signupDigest(input.recoveryToken),
  };
  let row: RecoveryRecord = { state: "unconfirmed" };
  try {
    row = await deps.record(input.mode === "check" ? "check" : "reserve", values);
    if (input.mode === "check" || !["reserved", "not_sent"].includes(row.state))
      return publicSignupState(row);
    let preflight: Awaited<ReturnType<SignupRecoveryDependencies["preflight"]>>;
    try {
      preflight = await deps.preflight(values._email_hash);
    } catch {
      preflight = { proceed: false, code: "SIGNUP_NOT_STARTED", status: 503 };
    }
    if (!preflight.proceed) {
      row = await deps.record("defer", {
        ...values,
        _code: preflight.code ?? "SIGNUP_NOT_STARTED",
        _status: preflight.status ?? 503,
      });
      return publicSignupState(row);
    }
    row = await deps.record("claim", values);
    if (!row.claimed || !row.lease_id) return publicSignupState(row);
    let outcome: "accepted" | "existing" | "unconfirmed" = "unconfirmed";
    try {
      const result = await deps.invite();
      if (result.error)
        outcome =
          classifySignupInviteError(result.error) === "existing" ? "existing" : "unconfirmed";
      else if (result.data?.user?.id && z.string().uuid().safeParse(result.data.user.id).success)
        outcome = "accepted";
    } catch {
      /* The provider may have accepted the request; never replay it. */
    }
    try {
      row = await deps.record("settle", { ...values, _lease_id: row.lease_id, _outcome: outcome });
    } catch {
      row = { state: "unconfirmed", request_id: row.request_id };
    }
    return publicSignupState(row);
  } catch {
    return {
      ...publicSignupState({ state: "unconfirmed", request_id: row.request_id }),
      retryable: false,
    };
  }
}
