// Lightweight PII redaction for outbound LLM prompts.
// Catches the high-signal categories; deterministic, no network calls.
//
// ─── policy_version semantics ─────────────────────────────────────────────
// The string `PII_POLICY_VERSION` is stamped on every `ai_usage_events` row
// produced by `redactAndAudit`. Treat it as an immutable identifier of the
// regex set + masking behaviour. Bumping it is a **breaking change**:
//
//   1. Every downstream consumer (compliance dashboards, DLP analytics,
//      tenant-export ledgers) treats `policy_version` as a join key.
//   2. A bump implies a one-time backfill audit row of type
//      `pii.policy_version.bumped` (out of scope for this PR — see
//      docs/runbooks/pii-policy-rotation.md when authored).
//   3. Existing audit rows MUST NOT be rewritten; the historical version
//      stays attached to historical events.
//
// Do not bump casually. Add a new pattern → keep version the same. Remove a
// pattern or change masking semantics → bump.
// ──────────────────────────────────────────────────────────────────────────

export const PII_POLICY_VERSION = "pii-policy@1";

const PATTERNS: { name: string; re: RegExp; mask: (m: string) => string }[] = [
  { name: "email", re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, mask: () => "[REDACTED_EMAIL]" },
  { name: "iban", re: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, mask: () => "[REDACTED_IBAN]" },
  { name: "credit_card", re: /\b(?:\d[ -]*?){13,19}\b/g, mask: (m) => luhn(m.replace(/\D/g, "")) ? "[REDACTED_CARD]" : m },
  { name: "ssn_us", re: /\b\d{3}-\d{2}-\d{4}\b/g, mask: () => "[REDACTED_SSN]" },
  { name: "phone", re: /\+?\d[\d\s().-]{8,16}\d/g, mask: (m) => m.replace(/\D/g, "").length >= 10 ? "[REDACTED_PHONE]" : m },
  { name: "ipv4", re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, mask: () => "[REDACTED_IP]" },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b/g, mask: () => "[REDACTED_JWT]" },
  { name: "api_key", re: /\b(sk|pk|rk|api|key)[_-][A-Za-z0-9]{16,}\b/gi, mask: () => "[REDACTED_KEY]" },
];

function luhn(num: string): boolean {
  if (num.length < 13) return false;
  let sum = 0, dbl = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = num.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d; dbl = !dbl;
  }
  return sum % 10 === 0;
}

export interface RedactionResult {
  text: string;
  counts: Record<string, number>;
  redacted: boolean;
}

export interface StrictRedactionResult extends RedactionResult {
  hadRedactions: boolean;
}

export function redactPii(input: string): RedactionResult {
  const counts: Record<string, number> = {};
  let text = input;
  try {
    for (const p of PATTERNS) {
      text = text.replace(p.re, (m) => {
        const masked = p.mask(m);
        if (masked !== m) counts[p.name] = (counts[p.name] ?? 0) + 1;
        return masked;
      });
    }
  } catch (e) {
    // Fail-closed (per architecture §5.5): never let a redaction failure
    // leak the raw input downstream to an LLM.
    throw new Error(`pii_redaction_failed: ${(e as Error).message}`);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { text, counts, redacted: total > 0 };
}

/**
 * Strict variant for the AI gateway. Throws on any failure or empty output.
 * The gateway MUST use this — never fall back to raw input.
 */
export function redactPiiOrThrow(input: string): RedactionResult {
  if (typeof input !== "string") throw new Error("pii_redaction_failed: non-string input");
  const r = redactPii(input);
  if (typeof r.text !== "string") throw new Error("pii_redaction_failed: empty output");
  return r;
}

/**
 * Non-throwing strict variant. Returns a sentinel on regex failure so
 * callers can safely substitute without crashing the request. Use this in
 * defensive paths (background jobs, telemetry batchers) where throwing
 * would silently drop the parent unit of work.
 */
export function redactStrict(input: string): StrictRedactionResult {
  try {
    if (typeof input !== "string") {
      return { text: "[REDACTION_FAILED]", counts: {}, hadRedactions: false, redacted: false };
    }
    const r = redactPii(input);
    const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
    return { ...r, hadRedactions: total > 0 };
  } catch {
    return { text: "[REDACTION_FAILED]", counts: {}, hadRedactions: false, redacted: false };
  }
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const arr = Array.from(new Uint8Array(buf));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type RedactDestination = "copilot" | "agent" | "embed" | "email";

export interface RedactAuditContext {
  supabase: any;
  /**
   * Tenant the redaction belongs to. `null` means the caller could not
   * attribute the payload to a tenant (orphan thread, system-generated job,
   * platform-scope action). In that case we DO NOT write a tenant-less row
   * into `ai_usage_events` — instead we emit a `pii.redaction.unattributed`
   * `security_events` row so the orphan is visible to the security team.
   */
  tenantId: string | null;
  callerId: string;
  destination: RedactDestination;
}

/**
 * Redact PII and emit a structured audit row to ai_usage_events.
 *
 * The audit write is fire-and-forget — failures are logged but never
 * propagated to the caller (we will not break a Copilot/Agent turn because
 * the telemetry sink is down). The DB row is shaped to fit the existing
 * `ai_usage_events` schema: PII-specific fields are packed into `meta` and
 * the row is tagged with `model = 'pii-redactor'`.
 *
 * When `tenantId` is `null` the row is redirected to `security_events`
 * with `event_type = 'pii.redaction.unattributed'` and severity `warning`,
 * so the redaction is still recorded but cannot be silently logged against
 * an unknown tenant.
 */
export async function redactAndAudit(
  input: string,
  context: RedactAuditContext,
): Promise<string> {
  const { text, counts, redacted } = redactPii(input);
  let inputHash = "";
  try {
    inputHash = await sha256Hex(input);
  } catch (e) {
    console.error("[pii-redact] sha256 failed", e);
  }

  // Fire-and-forget audit write.
  try {
    if (context.tenantId === null) {
      await context.supabase.from("security_events").insert({
        tenant_id: null,
        user_id: context.callerId,
        event_type: "pii.redaction.unattributed",
        severity: "warning",
        context: {
          destination: context.destination,
          counts,
          redacted,
          input_hash: inputHash,
          policy_version: PII_POLICY_VERSION,
          reason: "missing_tenant_id",
        },
      });
    } else {
      await context.supabase.from("ai_usage_events").insert({
        tenant_id: context.tenantId,
        user_id: context.callerId,
        scope: "pii.redaction",
        model: "pii-redactor",
        tokens_in: 0,
        tokens_out: 0,
        cost_usd: 0,
        meta: {
          event_type: "pii.redaction",
          destination: context.destination,
          counts,
          redacted,
          input_hash: inputHash,
          policy_version: PII_POLICY_VERSION,
        },
        created_at: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.error("[pii-redact] audit write failed", e);
  }

  return text;
}
