import { publicIncidentSchema } from "@/lib/status.model";
import { sendViaZeptoMail, type ZeptoSendRequest } from "@/lib/email-templates/zeptomail";

export type StatusDeliveryClaim = { lease_id: string; subscriber_id: string; email: string;
  verified_at: string | null; consent_method: "verified_email_link" | null; confirmation_provider_receipt: string | null;
  unsubscribed: boolean; component_keys: string[] };
const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** Private worker adapter only. Parent must bind claim/currentConsent/settle to
 * its verified consent/outbox store and explicit QA gate before scheduling.
 * No public caller can choose a recipient or invoke this through a server fn. */
export async function deliverConfirmedStatusUpdate(event: unknown, dependencies: {
  parentQaApproved: boolean;
  claim: (eventId: string, version: number) => Promise<StatusDeliveryClaim | null>;
  currentConsent: (subscriberId: string) => Promise<StatusDeliveryClaim | null>;
  settle: (leaseId: string, state: "provider_accepted" | "suppressed" | "uncertain", reference?: string) => Promise<void>;
  zepto: { apiToken: string; apiBase?: string; from: { email: string; name?: string } };
  send?: typeof sendViaZeptoMail;
}) {
  if (!dependencies.parentQaApproved) return { state: "held_for_parent_qa" as const };
  const incident = publicIncidentSchema.parse(event);
  const claim = await dependencies.claim(incident.id, incident.version);
  if (!claim) return { state: "not_claimed" as const };
  const consent = await dependencies.currentConsent(claim.subscriber_id);
  if (!consent || consent.unsubscribed || !consent.verified_at || !Number.isFinite(Date.parse(consent.verified_at)) || Date.parse(consent.verified_at)>Date.now() || consent.consent_method !== "verified_email_link" || !consent.confirmation_provider_receipt
    || consent.email !== claim.email || consent.component_keys.length > 0 && !consent.component_keys.some((key) => incident.component_keys.includes(key))) {
    await dependencies.settle(claim.lease_id, "suppressed"); return { state: "suppressed" as const };
  }
  const text = `${incident.title}\n${incident.status}\n${incident.summary}\nEvent: ${incident.occurred_at}\nPublished: ${incident.published_at}\nhttps://status.reconiq.example/`;
  const request: ZeptoSendRequest = { from: dependencies.zepto.from, to: [{ email: consent.email }], subject: `ReconIQ status: ${incident.title}`,
    textBody: text, htmlBody: `<h1>${escape(incident.title)}</h1><p>${escape(incident.status)}</p><p>${escape(incident.summary)}</p><p>Event: ${escape(incident.occurred_at)}</p><p>Published: ${escape(incident.published_at)}</p><p><a href="https://status.reconiq.example/">View ReconIQ status</a></p>`,
    clientReference: `rq-status-${incident.id}-${incident.version}`, trackClicks: false, trackOpens: false };
  let providerReference: string;
  try {
    const receipt = await (dependencies.send ?? sendViaZeptoMail)(request, { apiToken: dependencies.zepto.apiToken, apiBase: dependencies.zepto.apiBase });
    if (receipt.error || !receipt.messageId || !/^[A-Za-z0-9_.:-]{1,200}$/.test(receipt.messageId) || /^(?:Zoho-enczapikey|sb_secret_|Bearer)/i.test(receipt.messageId)) throw new Error("Unconfirmed provider receipt");
    providerReference=receipt.messageId;
  } catch {
    // Provider acceptance may have occurred. Never auto-resend after ambiguity.
    await dependencies.settle(claim.lease_id, "uncertain"); return { state: "uncertain" as const };
  }
  try { await dependencies.settle(claim.lease_id,"provider_accepted",providerReference);return {state:"provider_accepted" as const}; }
  catch { return {state:"provider_accepted_receipt_unconfirmed" as const}; }
}
