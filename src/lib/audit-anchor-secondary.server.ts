// C-2 — Secondary audit anchor publisher.
//
// Posts the row_hash_hex of the daily anchor to a configurable external
// witness so that even if both the DB row and the R2 object were tampered
// with, an independent third party still holds a copy of the hash.
//
// Default witness: Twitter (X) v2 `POST /2/tweets`. The endpoint requires
// OAuth 1.0a user context — bearer alone is read-only. Env contract:
//
//   TWITTER_BEARER_TOKEN  (optional; carried through for parity with spec)
//   TWITTER_API_KEY       (OAuth 1.0a consumer key)
//   TWITTER_API_SECRET    (OAuth 1.0a consumer secret)
//   TWITTER_ACCESS_TOKEN  (OAuth 1.0a access token)
//   TWITTER_ACCESS_SECRET (OAuth 1.0a access token secret)
//
// If any of API_KEY / API_SECRET / ACCESS_TOKEN / ACCESS_SECRET is missing
// we log a warning to security_events and return cleanly — the primary
// (DB + R2) chain is unaffected.

import { createHmac, randomBytes } from "node:crypto";

export interface SecondaryAnchorRow {
  id: string | number;
  anchored_at: string;
  last_audit_id: number;
  row_hash_hex: string;
}

export interface SecondaryAnchorResult {
  status: "published" | "skipped" | "failed";
  reason?: string;
  externalRef?: string;
}

interface AdminLike {
  from: (table: string) => {
    insert: (row: unknown) => Promise<{ error: unknown }>;
  };
}

interface TwitterEnv {
  SECONDARY_ANCHOR_ENABLED?: string;
  TWITTER_BEARER_TOKEN?: string;
  TWITTER_API_KEY?: string;
  TWITTER_API_SECRET?: string;
  TWITTER_ACCESS_TOKEN?: string;
  TWITTER_ACCESS_SECRET?: string;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) =>
    "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

// OAuth 1.0a HMAC-SHA1 signature for POST https://api.twitter.com/2/tweets.
// JSON body is NOT included in the signature base string (per RFC 5849 +
// Twitter docs — only application/x-www-form-urlencoded body params are).
function buildOauthHeader(
  method: string,
  url: string,
  env: Required<Pick<TwitterEnv, "TWITTER_API_KEY" | "TWITTER_API_SECRET" | "TWITTER_ACCESS_TOKEN" | "TWITTER_ACCESS_SECRET">>,
  nonceSource: () => string = () => randomBytes(16).toString("hex"),
  nowSeconds: () => number = () => Math.floor(Date.now() / 1000),
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: env.TWITTER_API_KEY,
    oauth_nonce: nonceSource(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(nowSeconds()),
    oauth_token: env.TWITTER_ACCESS_TOKEN,
    oauth_version: "1.0",
  };

  const paramString = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(oauthParams[k])}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(paramString),
  ].join("&");

  const signingKey = `${percentEncode(env.TWITTER_API_SECRET)}&${percentEncode(env.TWITTER_ACCESS_SECRET)}`;
  const signature = createHmac("sha1", signingKey).update(baseString).digest("base64");

  const header =
    "OAuth " +
    Object.entries({ ...oauthParams, oauth_signature: signature })
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
      .join(", ");

  return header;
}

export function buildAnchorTweetText(row: SecondaryAnchorRow): string {
  // Short, machine-parseable. Stays well under 280 chars.
  return [
    "ReconIQ audit anchor",
    `anchored_at=${row.anchored_at}`,
    `last_audit_id=${row.last_audit_id}`,
    `row_hash=${row.row_hash_hex}`,
  ].join(" | ");
}

export async function writeSecondaryAnchor(
  admin: AdminLike,
  anchorRow: SecondaryAnchorRow,
  env: TwitterEnv = process.env as TwitterEnv,
  fetchImpl: FetchLike = fetch,
): Promise<SecondaryAnchorResult> {
  if (env.SECONDARY_ANCHOR_ENABLED !== "true") {
    return { status: "skipped", reason: "secondary_anchor_disabled" };
  }
  const { TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET } = env;
  if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) {
    const reason = "missing_twitter_oauth_env";
    console.warn(`[audit-anchor-secondary] ${reason} — secondary anchor skipped`);
    try {
      await admin.from("security_events").insert({
        event_type: "audit.anchor.secondary.skipped",
        severity: "info",
        context: { reason, last_audit_id: anchorRow.last_audit_id },
      });
    } catch (e) {
      console.warn("[audit-anchor-secondary] failed to log skip event", e);
    }
    return { status: "skipped", reason };
  }

  const url = "https://api.twitter.com/2/tweets";
  const text = buildAnchorTweetText(anchorRow);
  const authHeader = buildOauthHeader("POST", url, {
    TWITTER_API_KEY,
    TWITTER_API_SECRET,
    TWITTER_ACCESS_TOKEN,
    TWITTER_ACCESS_SECRET,
  });

  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const reason = `http_${res.status}`;
      await admin.from("security_events").insert({
        event_type: "audit.anchor.secondary.failed",
        severity: "warning",
        context: {
          reason,
          last_audit_id: anchorRow.last_audit_id,
          response_excerpt: body.slice(0, 200),
        },
      });
      return { status: "failed", reason };
    }
    const json = (await res.json().catch(() => ({}))) as { data?: { id?: string } };
    const externalRef = json.data?.id ? `twitter:${json.data.id}` : "twitter:unknown";
    await admin.from("security_events").insert({
      event_type: "audit.anchor.secondary.published",
      severity: "info",
      context: {
        witness: "twitter",
        external_ref: externalRef,
        last_audit_id: anchorRow.last_audit_id,
        row_hash_hex: anchorRow.row_hash_hex,
      },
    });
    return { status: "published", externalRef };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    try {
      await admin.from("security_events").insert({
        event_type: "audit.anchor.secondary.failed",
        severity: "warning",
        context: { reason, last_audit_id: anchorRow.last_audit_id },
      });
    } catch {
      /* swallow — primary chain is authoritative */
    }
    return { status: "failed", reason };
  }
}
