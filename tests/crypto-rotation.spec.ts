// C-4 — encryption rotation test
//
// Verifies the symmetric guarantees a real key-rotation worker depends on:
//   a. Encrypt three fields with key A
//   b. Generate key B
//   c. Decrypt with A, re-encrypt with B
//   d. All three fields decrypt correctly with B
//   e. Key A no longer decrypts the rotated ciphertext (GCM auth tag fails)
//
// We use the with-key helpers (encryptFieldWithKey / decryptFieldWithKey)
// so the env-bound module cache is irrelevant.
import { describe, it, expect, beforeAll } from "vitest";

process.env.APP_DATA_ENC_KEY = process.env.APP_DATA_ENC_KEY ?? "test-key-base-for-module-load-only";

let encryptFieldWithKey: typeof import("@/lib/crypto.server").encryptFieldWithKey;
let decryptFieldWithKey: typeof import("@/lib/crypto.server").decryptFieldWithKey;

beforeAll(async () => {
  const mod = await import("@/lib/crypto.server");
  encryptFieldWithKey = mod.encryptFieldWithKey;
  decryptFieldWithKey = mod.decryptFieldWithKey;
});

const KEY_A = "rotation-test-key-A-" + "a".repeat(32);
const KEY_B = "rotation-test-key-B-" + "b".repeat(32);

describe("C-4 crypto key rotation", () => {
  it("re-keys 3 fields from A to B; B decrypts, A no longer does", async () => {
    const plaintexts = ["customer ticket body 1", "agent reply ✉️", "ARN:aws:kms:eu-west-1:redacted"];

    // (a) Encrypt with key A
    const ctA = await Promise.all(plaintexts.map((p) => encryptFieldWithKey(KEY_A, p)));
    expect(ctA.every((c) => c.startsWith("enc:v1:"))).toBe(true);

    // (b) generate key B already done above

    // (c) Decrypt with A, re-encrypt with B
    const ctB = await Promise.all(
      ctA.map(async (c) => {
        const pt = await decryptFieldWithKey(KEY_A, c);
        return encryptFieldWithKey(KEY_B, pt);
      }),
    );

    // (d) All three round-trip cleanly under key B
    for (let i = 0; i < plaintexts.length; i++) {
      const pt = await decryptFieldWithKey(KEY_B, ctB[i]);
      expect(pt).toBe(plaintexts[i]);
    }

    // (e) Key A no longer works against the rotated ciphertext.
    for (const c of ctB) {
      await expect(decryptFieldWithKey(KEY_A, c)).rejects.toBeDefined();
    }

    // Sanity: the new ciphertext is NOT byte-equal to the old (fresh IV + new key).
    for (let i = 0; i < ctA.length; i++) expect(ctB[i]).not.toBe(ctA[i]);
  });
});
