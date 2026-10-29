import type { ZeptoSendRequest } from "./email-templates/zeptomail";
import { renderFailedLoginEmail } from "./email-templates/failed-login";
import { failedLoginCanonicalOrigin } from "./failed-login-auth.server";
import { getRuntimeEnv } from "./runtime-env.server";

export type FailedLoginProviderReceipt =
  | { state: "provider_accepted"; messageId: string }
  | { state: "retry" | "uncertain"; code: "provider_rejected" | "provider_rate_limited" | "provider_timeout" | "provider_response_unknown" | "provider_unavailable" };

function isProviderReference(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(value)
    && !/^(?:request:)?[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
    && !/^(?:request:)?(?:sb_secret_|sb_publishable_|sbp_|Zoho-enczapikey)/i.test(value);
}

// Notification-specific transport on the existing ZeptoMail binding. The shared
// sender is preserved; this branch also checks 2xx error blocks/array receipts.
export async function sendFailedLoginEmail(req: ZeptoSendRequest, apiToken: string, transport: typeof fetch = fetch): Promise<FailedLoginProviderReceipt> {
  let response: Response;
  try {
    response = await transport("https://api.zeptomail.in/v1.1/email", {
      method: "POST", signal: AbortSignal.timeout(15000),
      headers: { Authorization: apiToken.startsWith("Zoho-enczapikey ") ? apiToken : `Zoho-enczapikey ${apiToken}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ from: { address: req.from.email, name: req.from.name }, to: req.to.map(t => ({ email_address: { address: t.email } })), subject: req.subject, htmlbody: req.htmlBody, textbody: req.textBody, client_reference: req.clientReference }),
    });
  } catch {
    // client_reference is a tracking reference, not a provider idempotency key.
    // A lost HTTP response might have been accepted; don't automatically resend.
    return { state: "uncertain", code: "provider_timeout" };
  }
  if (response.status === 429) return { state: "retry", code: "provider_rate_limited" };
  if (response.status >= 400 && response.status < 500) return { state: "retry", code: "provider_rejected" };
  if (!response.ok) return { state: "uncertain", code: "provider_unavailable" };
  let payload: any;
  try { payload = await response.json(); } catch { return { state: "uncertain", code: "provider_response_unknown" }; }
  if (payload?.error) return { state: "retry", code: "provider_rejected" };
  const data = Array.isArray(payload?.data) ? payload.data[0] : payload?.data;
  const messageId = payload?.messageId ?? data?.message_id;
  const receipt = messageId ?? (data?.code === "EM_104" && typeof payload?.request_id === "string" ? `request:${payload.request_id}` : null);
  if (!isProviderReference(receipt)) return { state: "uncertain", code: "provider_response_unknown" };
  return { state: "provider_accepted", messageId: receipt };
}

type RpcClient = { rpc(name: string, data?: Record<string, unknown>): PromiseLike<{ data: any; error: unknown }> };
export async function processFailedLoginQueueMessage(admin: RpcClient, item: { msg_id: number; message: unknown }, apiToken: string, sender = sendFailedLoginEmail) {
  const message = item.message as { template?: unknown; attempt_id?: unknown } | null;
  if (message?.template !== "auth.failed_login.verified") return null;
  if (typeof message.attempt_id !== "string" || !/^[0-9a-f-]{36}$/i.test(message.attempt_id)) return { sent: 0, failed: 1, state: "invalid_event" };
  const claim = await admin.rpc("failed_login_claim", { _id: message.attempt_id, _queue_message_id: item.msg_id });
  if (claim.error || !claim.data) return { sent: 0, failed: 1, state: "claim_unavailable" };
  if (!claim.data.send) return { sent: 0, failed: 0, state: claim.data.state };
  let result: FailedLoginProviderReceipt;
  try {
    const notice = await renderFailedLoginEmail({ attemptId: message.attempt_id, requestId: claim.data.request_id, occurredAt: claim.data.occurred_at, outcome: claim.data.outcome, origin: failedLoginCanonicalOrigin() });
    result = await sender({ to: [{ email: claim.data.to }], from: { email: "security@reconintelligence.app", name: "ReconIQ Security" }, subject: notice.subject, htmlBody: notice.html, textBody: notice.text, clientReference: `fvi-failed-login-${message.attempt_id}` }, apiToken);
    if (result.state === "provider_accepted" && !isProviderReference(result.messageId)) {
      result = { state: "uncertain", code: "provider_response_unknown" };
    }
  } catch {
    // No raw provider exception/request/recipient goes to logs or audit.
    result = { state: "uncertain", code: "provider_response_unknown" };
  }
  const receipt = { _id: message.attempt_id, _lease_id: claim.data.lease_id, _state: result.state, _provider_message_id: result.state === "provider_accepted" ? result.messageId : null, _diagnostic_code: result.state === "provider_accepted" ? null : result.code };
  let settled = false;
  for (let retry = 0; retry < 2 && !settled; retry++) {
    const answer = await admin.rpc("failed_login_settle", receipt);
    settled = !answer.error && answer.data === true;
  }
  return { sent: result.state === "provider_accepted" && settled ? 1 : 0, failed: result.state !== "provider_accepted" || !settled ? 1 : 0, state: settled ? result.state : "receipt_unavailable" };
}

export async function recoverRecordedFailedLoginEmails(admin: RpcClient) {
  if (getRuntimeEnv("FAILED_LOGIN_NOTIFICATIONS_ENABLED") !== "true") return;
  const result = await admin.rpc("failed_login_requeue_recorded");
  if (result.error) throw new Error("Failed-login queue recovery unavailable");
}
