/**
 * ZeptoMail (Zoho) HTTP client.
 *
 * https://www.zoho.com/zeptomail/help/api/
 *
 * We use the HTTP API (not SMTP) so the auth flow can be invoked from
 * Cloudflare Workers / Edge Functions where opening arbitrary SMTP
 * connections is not possible.
 *
 * Auth: a single API token is sent in the `Authorization: Zoho-enczapikey …`
 * header. The token looks like `zoho-enczapikey PHtE4r.RE5d…`.
 *
 * Sender: transactional senders must be verified in the ZeptoMail dashboard
 * BEFORE the first send, or ZeptoMail rejects with 401/403.
 *
 * Free tier (as of 2026-Q3): up to 10,000 emails/month for the first 6 months
 * on the Zoho Workplace trial. After that, paid plans start around $3/month
 * for 10k emails. See ZeptoMail pricing page for current numbers.
 */

export interface ZeptoSendRequest {
  to: { email: string; name?: string }[];
  from: { email: string; name?: string };
  /** Reply-To is optional but recommended for transactional. */
  replyTo?: { email: string; name?: string };
  subject: string;
  /** HTML body. */
  htmlBody: string;
  /** Plain-text fallback (Ze deliverability drops if missing). */
  textBody: string;
  /** Optional tracking key. We generate one per send for log correlation. */
  clientReference?: string;
  /** Optional tracking pixel / click-tracker toggles. Default off for transactional. */
  trackOpens?: boolean;
  trackClicks?: boolean;
}

export interface ZeptoSendResponse {
  messageId?: string;
  requestId?: string;
  /** Raw ZeptoMail error block, if any. */
  error?: { code: string; message: string; detail?: unknown };
}

/** Build the wire payload ZeptoMail expects at POST /v1.1/email. */
function buildPayload(req: ZeptoSendRequest): unknown {
  return {
    from: { address: req.from.email, name: req.from.name ?? "" },
    to: req.to.map((t) => ({ email_address: { address: t.email, name: t.name ?? "" } })),
    reply_to: req.replyTo
      ? { address: req.replyTo.email, name: req.replyTo.name ?? "" }
      : undefined,
    subject: req.subject,
    htmlbody: req.htmlBody,
    textbody: req.textBody,
    client_reference: req.clientReference,
  };
}

/**
 * Send a single transactional email through ZeptoMail.
 * Returns the parsed response. Throws on network / auth failures.
 *
 * Throws { name: 'ZeptoMailError', code, message, status, body } on non-2xx.
 */
export async function sendViaZeptoMail(
  req: ZeptoSendRequest,
  opts: { apiToken: string; apiBase?: string },
): Promise<ZeptoSendResponse> {
  const base = opts.apiBase ?? "https://api.zeptomail.in";
  const res = await fetch(`${base}/v1.1/email`, {
    method: "POST",
    headers: {
      // ZeptoMail's auth header is non-standard
      Authorization: opts.apiToken.startsWith("Zoho-enczapikey ")
        ? opts.apiToken
        : `Zoho-enczapikey ${opts.apiToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(buildPayload(req)),
  });

  // ZeptoMail returns 200 on accepted, 201 on queued, 4xx on client error.
  // Some error codes return 200 with an `error` block — handle both.
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } })?.error;
    const e = new Error(
      `ZeptoMail send failed: HTTP ${res.status} ${err?.message ?? res.statusText}`,
    ) as Error & { name: string; code?: string; status: number; body: unknown };
    e.name = "ZeptoMailError";
    e.code = err?.code;
    e.status = res.status;
    e.body = json;
    throw e;
  }

  const parsed = json as ZeptoSendResponse & {
    data?: { message_id?: string; request_id?: string };
  };
  return {
    messageId: parsed.messageId ?? parsed.data?.message_id,
    requestId: parsed.requestId ?? parsed.data?.request_id,
  };
}
