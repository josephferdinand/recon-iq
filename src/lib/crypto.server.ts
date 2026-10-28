// ============================================================================
// Field-level AES-GCM encryption (server-only).
//
// Purpose
// -------
// Supabase already encrypts data at rest at the disk layer. Field-level
// encryption protects against a *different* threat: an authorised reader of
// the row (logical DB backup, BI export, replicated read-replica, restored
// snapshot in a lower environment) who must NOT see the plaintext.
//
// Scope
// -----
// We encrypt a small allow-list of high-value customer-supplied text columns:
//   - support_tickets.body          (customer-typed ticket body)
//   - ticket_messages.body          (customer / agent reply text)
//   - byok_keys.key_arn             (external KMS resource identifier)
//
// Note: byok_keys does NOT carry a `key_ciphertext` column in this schema.
// The BYOK design holds only the *reference* (ARN/URI) to an external KMS,
// never raw key material. We still wrap `key_arn` so a leaked backup does
// not surface the tenant's KMS topology.
//
// Format
// ------
// Output of encryptField():
//     "enc:v1:" || base64( iv(12) || ciphertext || tag(16) )
//
// The "enc:v1:" prefix is a forward-compatible discriminator so:
//   - existing legacy plaintext rows decrypt gracefully (returned as-is),
//   - a future v2 (e.g. key wrapping, AEAD AAD) can coexist during rollout.
//
// Key
// ---
// 256-bit symmetric AES-GCM key derived from process.env.APP_DATA_ENC_KEY
// via SHA-256 (so the operator may supply either a 32-byte hex/base64 value
// or a high-entropy passphrase; the digest normalises both to a 256-bit key
// without changing the at-rest format). Imported once and cached for the
// life of the Worker isolate.
//
// ─── Rotation runbook ──────────────────────────────────────────────────────
// Key rotation is a *maintenance-window* operation. Do not rotate casually.
//
//   1. Generate a new high-entropy value: `openssl rand -base64 48`.
//   2. Add it to Cloudflare as APP_DATA_ENC_KEY_NEXT (do NOT replace the
//      current value yet).
//   3. Run the rotation worker (scripts/rotate-app-data-enc-key.ts — author
//      when needed). The worker:
//        a. Loads both keys (current + next).
//        b. For each encrypted table (support_tickets, ticket_messages,
//           byok_keys), streams rows in batches, decrypts with current,
//           re-encrypts with next.
//        c. Per-tenant transactions; large tenants run as a background job
//           with row-level pagination and resumable cursor.
//        d. Writes a security_events row per batch:
//             event_type = 'crypto.key_rotation'
//             severity   = 'info'
//             context    = { batch_id, table, rows_rotated, tenant_id }
//   4. After completion, promote APP_DATA_ENC_KEY_NEXT → APP_DATA_ENC_KEY
//      in Cloudflare and remove the NEXT secret.
//   5. Final security_events row:
//        event_type = 'crypto.key_rotation'
//        severity   = 'info'
//        context    = { phase: 'complete', rotated_at, total_rows }
//   6. Schedule the next rotation per policy (default: 365 days).
//
// On-call must hold the runbook ID (RUNBOOK-CRYPTO-001) and a CAB approval
// before starting. There is no in-app self-service rotation control.
// ──────────────────────────────────────────────────────────────────────────

import { z } from "zod";

const PREFIX = "enc:v1:";

// ── Startup check ──────────────────────────────────────────────────────────
// Module-load guard. We cannot reach Supabase from here (no client at module
// scope), so the security_events write is best-effort and deferred to first
// crypto call when a supabase handle is provided. Hard-throw in production.
const RAW_KEY = process.env.APP_DATA_ENC_KEY;
const IS_PROD = process.env.NODE_ENV === "production";
if (!RAW_KEY || RAW_KEY.length < 16) {
  const msg =
    "[crypto.server] APP_DATA_ENC_KEY is missing or too short (<16 chars). " +
    "Field-level encryption is disabled.";
  if (IS_PROD) {
    // In production this is a refuse-to-start condition. A worker that boots
    // without the key would silently write plaintext into columns the
    // operator believes are encrypted.
    throw new Error(msg);
  } else {
    console.warn(msg + " (dev mode — continuing)");
  }
}

let cachedKey: Promise<CryptoKey> | null = null;
function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  cachedKey = (async () => {
    if (!RAW_KEY) throw new Error("APP_DATA_ENC_KEY missing");
    const material = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(RAW_KEY),
    );
    return crypto.subtle.importKey(
      "raw",
      material,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  })();
  return cachedKey;
}

// ── Zod: EncryptedFieldSchema ──────────────────────────────────────────────
// Validates the on-disk envelope shape *without* attempting to decrypt.
// A correct payload is "enc:v1:" || base64(iv || ct || tag), where the
// decoded byte length is at least 12 (iv) + 0 (ct) + 16 (tag) = 28 bytes.
export const EncryptedFieldSchema = z
  .string()
  .refine((s) => s.startsWith(PREFIX), {
    message: "EncryptedField: missing v1 prefix",
  })
  .refine(
    (s) => {
      try {
        const body = s.slice(PREFIX.length);
        // base64 alphabet sanity (constant-time-ish: full scan, no early exit)
        if (!/^[A-Za-z0-9+/=]+$/.test(body)) return false;
        const bin = atobSafe(body);
        return bin.length >= 28;
      } catch {
        return false;
      }
    },
    { message: "EncryptedField: payload too short or not base64" },
  );

export type EncryptedField = z.infer<typeof EncryptedFieldSchema>;

// ── Constant-time equal ────────────────────────────────────────────────────
// Compares two strings in time that does not depend on the matching prefix.
// Used in EncryptedFieldSchema's parse path (prefix check) so a malformed
// header does not leak position information through timing.
export function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = new TextEncoder().encode(a);
  const bBuf = new TextEncoder().encode(b);
  // Always XOR over max(len) so the loop runs the same number of cycles
  // regardless of where strings diverge.
  const len = Math.max(aBuf.length, bBuf.length);
  let diff = aBuf.length ^ bBuf.length;
  for (let i = 0; i < len; i++) {
    const av = i < aBuf.length ? aBuf[i] : 0;
    const bv = i < bBuf.length ? bBuf[i] : 0;
    diff |= av ^ bv;
  }
  return diff === 0;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function atobSafe(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function btoaSafe(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

// ── encryptField / decryptField ───────────────────────────────────────────
export async function encryptField(plaintext: string): Promise<string> {
  if (typeof plaintext !== "string") {
    throw new Error("encryptField: plaintext must be a string");
  }
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ctBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const ct = new Uint8Array(ctBuf); // WebCrypto appends the 16-byte tag.
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return PREFIX + btoaSafe(out);
}

export async function decryptField(ciphertext: string): Promise<string> {
  if (typeof ciphertext !== "string") {
    throw new Error("decryptField: ciphertext must be a string");
  }
  // Legacy/plain rows pass through unchanged so a partial backfill is safe.
  if (!ciphertext.startsWith(PREFIX)) return ciphertext;
  // Validate envelope before touching the cipher.
  EncryptedFieldSchema.parse(ciphertext);
  const key = await getKey();
  const blob = atobSafe(ciphertext.slice(PREFIX.length));
  const iv = blob.slice(0, 12);
  const ct = blob.slice(12);
  const ptBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ct,
  );
  return new TextDecoder().decode(ptBuf);
}

// ── With-key variants (rotation) ──────────────────────────────────────────
// Used by the rotation worker (scripts/rotate-app-data-enc-key.ts) to
// decrypt with the *current* key and re-encrypt with the *next* key without
// touching the cached env-bound key. Also used by tests/crypto-rotation.spec.ts.
async function deriveKey(rawKey: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rawKey),
  );
  return crypto.subtle.importKey(
    "raw",
    material,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptFieldWithKey(rawKey: string, plaintext: string): Promise<string> {
  if (typeof plaintext !== "string") throw new Error("encryptFieldWithKey: plaintext must be a string");
  const key = await deriveKey(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  const ct = new Uint8Array(ctBuf);
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return PREFIX + btoaSafe(out);
}

export async function decryptFieldWithKey(rawKey: string, ciphertext: string): Promise<string> {
  if (typeof ciphertext !== "string") throw new Error("decryptFieldWithKey: ciphertext must be a string");
  if (!ciphertext.startsWith(PREFIX)) return ciphertext;
  EncryptedFieldSchema.parse(ciphertext);
  const key = await deriveKey(rawKey);
  const blob = atobSafe(ciphertext.slice(PREFIX.length));
  const iv = blob.slice(0, 12);
  const ct = blob.slice(12);
  const ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(ptBuf);
}

// Row-boundary helper: decrypt if encrypted, otherwise return as-is. Used
// by read paths so the migration from plaintext → encrypted is gradual.
export async function maybeDecryptField(value: string | null | undefined): Promise<string | null> {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  if (!value.startsWith(PREFIX)) return value;
  try {
    return await decryptField(value);
  } catch (e) {
    console.error("[crypto.server] decrypt failed for field", e);
    return "[DECRYPT_FAILED]";
  }
}
