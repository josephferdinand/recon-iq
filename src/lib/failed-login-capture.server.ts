import { failedLoginOutcome, publicLoginError, type FailedLoginOutcome, type LoginStage } from "./failed-login-notifications";
import { randomUUID } from "node:crypto";

type ProviderError = { code?: string; status?: number };
export interface FailedLoginCaptureDependencies<T> {
  begin(requestId: string): Promise<{ acquired: boolean; outcome: string; requestId?: string }>;
  authenticate(): Promise<{ value: T | null; error: ProviderError | null }>;
  finish(outcome: "success" | FailedLoginOutcome): Promise<void>;
  diagnostic(code: "notification_record_unavailable", attemptId: string, requestId?: string): void;
}

// This function receives only a real provider operation from a server handler.
// The public endpoint never accepts an outcome, recipient or provider payload.
export async function captureFailedLogin<T>(attemptId: string, stage: LoginStage, deps: FailedLoginCaptureDependencies<T>) {
  // Distinct from the browser attempt/idempotency key. The trusted recorder
  // persists this server-generated support reference and returns it on replay.
  const generatedRequestId = randomUUID();
  let begun: { acquired: boolean; outcome: string; requestId?: string };
  try { begun = await deps.begin(generatedRequestId); }
  catch {
    deps.diagnostic("notification_record_unavailable", attemptId, generatedRequestId);
    return { ok: false as const, error: { ...publicLoginError("provider_unavailable"), requestId: generatedRequestId } };
  }
  const requestId = typeof begun.requestId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(begun.requestId)
    ? begun.requestId : generatedRequestId;
  if (!begun.acquired) {
    const outcome = failedLoginOutcomeForReplay(begun.outcome);
    return { ok: false as const, error: { ...publicFailure(outcome, stage), requestId } };
  }
  let result: { value: T | null; error: ProviderError | null };
  try { result = await deps.authenticate(); }
  catch { result = { value: null, error: { status: 503 } }; }
  const outcome = result.error || !result.value ? failedLoginOutcome(result.error ?? { status: 503 }, stage) : "success";
  // Retry recording, never authentication. A persistent write failure leaves
  // the reserved attempt visible for operator reconciliation without secrets.
  let recorded = false;
  for (let retry = 0; retry < 2 && !recorded; retry++) {
    try { await deps.finish(outcome); recorded = true; } catch { /* same immutable result */ }
  }
  if (!recorded) deps.diagnostic("notification_record_unavailable", attemptId, requestId);
  if (outcome !== "success") return { ok: false as const, error: { ...publicFailure(outcome, stage), requestId } };
  return { ok: true as const, value: result.value as T };
}

function publicFailure(outcome: FailedLoginOutcome, stage: LoginStage) {
  // Credential/account rejection differences stay private even when a provider
  // returns email_not_confirmed/user_not_found/user_banned instead of the usual
  // invalid_credentials. The email itself retains the truthful trusted reason.
  return publicLoginError(stage === "password" && outcome !== "rate_limited" && outcome !== "provider_unavailable"
    ? "invalid_credentials" : outcome);
}

function failedLoginOutcomeForReplay(value: string): FailedLoginOutcome {
  return ["invalid_credentials", "mfa_invalid", "mfa_expired", "account_locked", "rate_limited", "policy_blocked", "provider_unavailable", "verification_failed"].includes(value)
    ? value as FailedLoginOutcome : "provider_unavailable";
}
