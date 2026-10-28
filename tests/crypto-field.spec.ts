import { describe, it, expect, beforeAll } from "vitest";

// Set the key BEFORE importing the module under test (module-load guard).
beforeAll(() => {
  process.env.APP_DATA_ENC_KEY ??= "test-key-for-vitest-only-do-not-use-in-prod-32+chars";
});

import {
  encryptField,
  decryptField,
  EncryptedFieldSchema,
  constantTimeEqual,
} from "../src/lib/crypto.server";

const PLAINTEXTS = {
  ticket_body:
    "Customer reports failed reconciliation for trade 12345. " +
    "API key was rotated yesterday. Please investigate.",
  ticket_message:
    "Update: we tried the fix at 14:00 UTC, still seeing the same error.",
  byok_arn:
    "arn:aws:kms:eu-west-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab",
};

describe("encryptField / decryptField round-trip", () => {
  for (const [field, plaintext] of Object.entries(PLAINTEXTS)) {
    it(`${field}: round-trips to original plaintext`, async () => {
      const ct = await encryptField(plaintext);
      expect(ct.startsWith("enc:v1:")).toBe(true);
      const pt = await decryptField(ct);
      expect(pt).toBe(plaintext);
    });

    it(`${field}: ciphertext is not equal to plaintext`, async () => {
      const ct = await encryptField(plaintext);
      expect(ct).not.toContain(plaintext);
      expect(ct).not.toBe(plaintext);
    });

    it(`${field}: two encrypts of same plaintext yield different ciphertexts (fresh IV)`, async () => {
      const ct1 = await encryptField(plaintext);
      const ct2 = await encryptField(plaintext);
      expect(ct1).not.toBe(ct2);
    });
  }

  it("decrypt with wrong key throws", async () => {
    const ct = await encryptField(PLAINTEXTS.ticket_body);
    // Tamper the auth tag: flip the last byte of the base64 payload.
    const tampered =
      "enc:v1:" +
      (() => {
        const body = ct.slice("enc:v1:".length);
        const bin = atob(body);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        arr[arr.length - 1] ^= 0xff;
        let s = "";
        for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
        return btoa(s);
      })();
    await expect(decryptField(tampered)).rejects.toBeDefined();
  });
});

describe("EncryptedFieldSchema", () => {
  it("accepts a valid envelope", async () => {
    const ct = await encryptField("hello");
    expect(() => EncryptedFieldSchema.parse(ct)).not.toThrow();
  });

  it("rejects missing prefix", () => {
    expect(() => EncryptedFieldSchema.parse("just plain text")).toThrow();
  });

  it("rejects empty string", () => {
    expect(() => EncryptedFieldSchema.parse("")).toThrow();
  });

  it("rejects non-base64 body", () => {
    expect(() => EncryptedFieldSchema.parse("enc:v1:!!!not_base64!!!")).toThrow();
  });

  it("rejects payload shorter than iv+tag (28 bytes)", () => {
    // 10 bytes base64 -> too short.
    expect(() => EncryptedFieldSchema.parse("enc:v1:" + btoa("short"))).toThrow();
  });
});

describe("constantTimeEqual", () => {
  it("returns true for equal strings", () => {
    expect(constantTimeEqual("alpha-bravo-charlie", "alpha-bravo-charlie")).toBe(true);
  });

  it("returns false for different strings of equal length", () => {
    expect(constantTimeEqual("alpha-bravo-charlie", "alpha-bravo-charliE")).toBe(false);
  });

  it("returns false for strings of different length", () => {
    expect(constantTimeEqual("short", "much longer string")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(constantTimeEqual("", "")).toBe(true);
  });
});

describe("legacy plaintext passthrough", () => {
  it("decryptField returns plaintext as-is when prefix missing (gradual migration safety)", async () => {
    const legacy = "row written before encryption rollout";
    expect(await decryptField(legacy)).toBe(legacy);
  });
});
