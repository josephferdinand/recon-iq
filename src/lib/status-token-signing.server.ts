/**
 * Status subscription token signing.
 *
 * Tokens are random 256-bit strings stored as SHA-256 hashes. This module
 * adds an HMAC-SHA256 signature layer so that tokens are self-authenticating:
 * even if the database is compromised, an attacker cannot forge new tokens
 * without the signing secret.
 *
 * Token format: <random_hex>.<hmac_hex>
 *   - random_hex: 64 hex chars (32 bytes, same as before)
 *   - hmac_hex: 64 hex chars (HMAC-SHA256 of random_hex)
 */

const STATUS_TOKEN_HMAC_SECRET = process.env.STATUS_TOKEN_HMAC_SECRET;

async function hmac(plaintext: string): Promise<string> {
  if (!STATUS_TOKEN_HMAC_SECRET) return "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(STATUS_TOKEN_HMAC_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(plaintext));
  return Buffer.from(new Uint8Array(sig)).toString("hex");
}

/**
 * Sign a random hex token. Returns "<hex>.<hmac>" if a secret is configured,
 * or just the raw hex for environments without the secret (dev/test).
 */
export async function signStatusToken(randomHex: string): Promise<string> {
  const signature = await hmac(randomHex);
  return signature ? `${randomHex}.${signature}` : randomHex;
}

/**
 * Verify and return the random hex portion, or null if invalid.
 */
export async function verifyStatusToken(token: string): Promise<string | null> {
  const idx = token.lastIndexOf(".");
  if (idx < 0) return null;
  const randomHex = token.slice(0, idx);
  const signature = token.slice(idx + 1);
  if (randomHex.length !== 64 || signature.length !== 64) return null;

  const expected = await hmac(randomHex);
  if (!expected || signature !== expected) return null;
  return randomHex;
}
