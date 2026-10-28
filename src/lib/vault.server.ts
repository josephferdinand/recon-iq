// ─────────────────────────────────────────────────────────────────────────────
// In-App Vault — Envelope-encrypted secret storage
//
// Design:
//   plaintext ──AES-256-GCM(DEK)──▶ ciphertext (+ iv, tag)
//   DEK       ──wrap(KEK)────────▶ wrapped_dek
//
// KEK ("Key Encryption Key") comes from a KMS adapter:
//   • meta_managed → APP_DATA_ENC_KEY derived AES-256-GCM key (Worker-native)
//   • aws_kms         → AWS KMS Encrypt / Decrypt for the DEK
//   • gcp_kms         → GCP Cloud KMS (stub — enable via project IAM)
//   • azure_kv        → Azure Key Vault (stub — enable via project IAM)
//
// This module is SERVER-ONLY. Never import from client-reachable modules at
// top scope.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, randomBytes } from "node:crypto";

const KEK_RAW = process.env.APP_DATA_ENC_KEY;
if (!KEK_RAW || KEK_RAW.length < 16) {
  const msg = "[vault.server] APP_DATA_ENC_KEY missing or <16 chars. Vault is disabled.";
  if (process.env.NODE_ENV === "production") throw new Error(msg);
  else console.warn(msg + " (dev mode — continuing)");
}

let cachedKek: Promise<CryptoKey> | null = null;
async function getMetaManagedKek(): Promise<CryptoKey> {
  if (cachedKek) return cachedKek;
  cachedKek = (async () => {
    const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(KEK_RAW!));
    return crypto.subtle.importKey("raw", material as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  })();
  return cachedKek;
}

// ─── KMS adapter interface ───────────────────────────────────────────────────
export type KmsProvider = "meta_managed" | "aws_kms" | "gcp_kms" | "azure_kv" | "hashicorp_vault" | "cyberark_conjur";
export interface KmsAdapter {
  provider: KmsProvider;
  keyRef: string;
  wrap(dek: Uint8Array): Promise<Uint8Array>;
  unwrap(wrapped: Uint8Array): Promise<Uint8Array>;
}

class MetaManagedAdapter implements KmsAdapter {
  provider: KmsProvider = "meta_managed";
  keyRef = "APP_DATA_ENC_KEY";
  async wrap(dek: Uint8Array): Promise<Uint8Array> {
    const key = await getMetaManagedKek();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, dek as BufferSource));
    // Prepend iv (12 bytes) so unwrap can split.
    const out = new Uint8Array(iv.length + ct.length);
    out.set(iv, 0); out.set(ct, iv.length);
    return out;
  }
  async unwrap(wrapped: Uint8Array): Promise<Uint8Array> {
    const key = await getMetaManagedKek();
    const iv = wrapped.slice(0, 12);
    const ct = wrapped.slice(12);
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct as BufferSource));
  }
}

class NotImplementedAdapter implements KmsAdapter {
  provider: KmsProvider;
  keyRef: string;
  constructor(provider: KmsProvider, keyRef: string) { this.provider = provider; this.keyRef = keyRef; }
  async wrap(): Promise<Uint8Array> {
    throw new Error(`[vault] KMS provider "${this.provider}" is registered but not yet wired for wrap. Configure IAM under Platform → Vault → KMS.`);
  }
  async unwrap(): Promise<Uint8Array> {
    throw new Error(`[vault] KMS provider "${this.provider}" is registered but not yet wired for unwrap. Configure IAM under Platform → Vault → KMS.`);
  }
}

export function getAdapter(provider: KmsProvider, keyRef: string): KmsAdapter {
  if (provider === "meta_managed") return new MetaManagedAdapter();
  // External adapters are dynamically imported per call to keep this module
  // free of top-level heavy imports and to allow the adapter file to be
  // tree-shaken in code paths that never touch external KMS.
  const loadA = async () => await import("./vault-adapters.server");
  const make = async (): Promise<KmsAdapter> => {
    const A = await loadA();
    switch (provider) {
      case "aws_kms":         return new A.AwsKmsAdapter(keyRef);
      case "azure_kv":        return new A.AzureKeyVaultAdapter(keyRef);
      case "gcp_kms":         return new A.GcpKmsAdapter(keyRef);
      case "hashicorp_vault": return new A.HashiCorpVaultAdapter(keyRef);
      case "cyberark_conjur": return new A.CyberArkConjurAdapter(keyRef);
      default:                return new NotImplementedAdapter(provider, keyRef);
    }
  };
  return {
    provider, keyRef,
    async wrap(dek: Uint8Array) { return (await make()).wrap(dek); },
    async unwrap(w: Uint8Array) { return (await make()).unwrap(w); },
  };
}

// ─── Core encrypt / decrypt ──────────────────────────────────────────────────
export interface EncryptedRecord {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  auth_tag: Uint8Array;
  wrapped_dek: Uint8Array;
  kek_provider: KmsProvider;
  kek_ref: string;
  fingerprint_sha256: string;
  last4: string;
}

export async function encryptSecret(
  plaintext: string,
  adapter: KmsAdapter = new MetaManagedAdapter(),
): Promise<EncryptedRecord> {
  if (!plaintext) throw new Error("plaintext required");
  const dek = crypto.getRandomValues(new Uint8Array(32)); // AES-256
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const dekKey = await crypto.subtle.importKey("raw", dek as BufferSource, { name: "AES-GCM" }, false, ["encrypt"]);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dekKey, new TextEncoder().encode(plaintext) as BufferSource),
  );
  // WebCrypto returns ciphertext||tag concatenated (last 16 bytes = tag).
  const ct = encrypted.slice(0, encrypted.length - 16);
  const tag = encrypted.slice(encrypted.length - 16);
  const wrapped = await adapter.wrap(dek);
  // Best-effort zero of DEK
  dek.fill(0);
  return {
    ciphertext: ct,
    iv,
    auth_tag: tag,
    wrapped_dek: wrapped,
    kek_provider: adapter.provider,
    kek_ref: adapter.keyRef,
    fingerprint_sha256: createHash("sha256").update(plaintext).digest("hex"),
    last4: plaintext.slice(-4),
  };
}

export async function decryptSecret(rec: {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  auth_tag: Uint8Array;
  wrapped_dek: Uint8Array;
  kek_provider: KmsProvider;
  kek_ref: string;
}): Promise<string> {
  const adapter = getAdapter(rec.kek_provider, rec.kek_ref);
  const dek = await adapter.unwrap(rec.wrapped_dek);
  const dekKey = await crypto.subtle.importKey("raw", dek as BufferSource, { name: "AES-GCM" }, false, ["decrypt"]);
  const combined = new Uint8Array(rec.ciphertext.length + rec.auth_tag.length);
  combined.set(rec.ciphertext, 0);
  combined.set(rec.auth_tag, rec.ciphertext.length);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: rec.iv as BufferSource }, dekKey, combined as BufferSource));
  dek.fill(0);
  return new TextDecoder().decode(pt);
}

// ─── Helpers for DB round-trip (bytea ↔ Uint8Array) ──────────────────────────
export function bytesToBase64(u: Uint8Array): string {
  let bin = ""; for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
  return btoa(bin);
}
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Postgres bytea escape: values come back from Supabase as "\x…" hex strings.
export function pgByteaToBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (typeof v === "string") {
    if (v.startsWith("\\x") || v.startsWith("\\\\x")) {
      const hex = v.replace(/^\\+x/, "");
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
      return out;
    }
    // base64 fallback
    return base64ToBytes(v);
  }
  throw new Error("pgByteaToBytes: unsupported value");
}

// Encode Uint8Array as a Postgres bytea hex literal ("\x…")
export function bytesToPgHex(u: Uint8Array): string {
  let hex = "\\x";
  for (let i = 0; i < u.length; i++) hex += u[i].toString(16).padStart(2, "0");
  return hex;
}
