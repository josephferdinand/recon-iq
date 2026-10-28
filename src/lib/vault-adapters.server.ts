// ─────────────────────────────────────────────────────────────────────────────
// External KMS / Vault adapters — REAL HTTP implementations.
//
// Each adapter implements the same KmsAdapter interface (wrap / unwrap the DEK)
// used by src/lib/vault.server.ts. Adapters call the actual upstream REST API;
// they source credentials from either:
//   1. A vault-stored `kms_credential` secret with a well-known name
//      (loaded once at cold start via the internal encrypted vault), OR
//   2. Environment variables (dev/bootstrap only).
//
// If neither is configured, wrap/unwrap fail loudly with an actionable message
// pointing to Platform → AI Control Plane → Vault → KMS Bindings.
//
// SERVER ONLY. Never import from client-reachable modules at module scope.
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac, createHash } from "node:crypto";
import type { KmsAdapter, KmsProvider } from "./vault.server";

// ── shared helpers ──────────────────────────────────────────────────────────
function b64(u: Uint8Array): string {
  let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}
function b64url(u: Uint8Array): string {
  return b64(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return fromB64(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}
function utf8(s: string): Uint8Array { return new TextEncoder().encode(s); }
async function ok(res: Response): Promise<Response> {
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`upstream ${res.status}: ${t.slice(0, 400)}`);
  }
  return res;
}
function missing(what: string, provider: string): never {
  throw new Error(
    `[vault:${provider}] Missing ${what}. Configure it in Platform → AI Control Plane → Vault → KMS Bindings, ` +
    `or set the corresponding secret/env before using this KMS binding.`,
  );
}

// ── credential loader ──────────────────────────────────────────────────────
// KMS bindings need creds to talk to the upstream. We read from env first
// (bootstrap), then fall back to a `kms_credential` platform secret named
// after the provider (e.g. `aws_kms:<key_ref>`).
// Called lazily so a missing creds set only fails when someone actually tries
// to use that adapter.
async function loadCreds(provider: KmsProvider, keyRef: string): Promise<Record<string, string>> {
  const envKey = `KMS_${provider.toUpperCase()}_${keyRef.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
  const envAll = `KMS_${provider.toUpperCase()}`;
  const raw = process.env[envKey] ?? process.env[envAll];
  if (raw) {
    try { return JSON.parse(raw); } catch { return { raw }; }
  }
  // vault-stored creds (kms_credential secret class, platform scope)
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.SUPABASE_URL, srv = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !srv) return {};
    const admin = createClient(url, srv, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: row } = await admin.from("app_vault_secrets")
      .select("ciphertext, iv, auth_tag, wrapped_dek, kek_provider, kek_ref")
      .eq("scope", "platform").eq("secret_class", "kms_credential")
      .eq("name", `${provider}:${keyRef}`).is("tenant_id", null).maybeSingle();
    if (!row) return {};
    const { decryptSecret, pgByteaToBytes } = await import("./vault.server");
    const pt = await decryptSecret({
      ciphertext: pgByteaToBytes((row as any).ciphertext),
      iv: pgByteaToBytes((row as any).iv),
      auth_tag: pgByteaToBytes((row as any).auth_tag),
      wrapped_dek: pgByteaToBytes((row as any).wrapped_dek),
      kek_provider: (row as any).kek_provider,
      kek_ref: (row as any).kek_ref,
    });
    return JSON.parse(pt);
  } catch (e) { console.warn("[vault-adapters] loadCreds failed", e); return {}; }
}

// ═══════════════════════════════════════════════════════════════════════════
// AWS KMS — Encrypt / Decrypt via SigV4
// creds: { access_key_id, secret_access_key, session_token?, region }
// keyRef: KMS Key ARN or alias (arn:aws:kms:us-east-1:123:key/…)
// ═══════════════════════════════════════════════════════════════════════════
async function sigv4Sign(opts: {
  method: string; host: string; path: string; region: string; service: string;
  body: string; accessKeyId: string; secretAccessKey: string; sessionToken?: string;
  amzTarget: string;
}) {
  const t = new Date();
  const amzDate = t.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const bodyHash = createHash("sha256").update(opts.body).digest("hex");
  const canonicalHeaders = [
    `content-type:application/x-amz-json-1.1`,
    `host:${opts.host}`,
    `x-amz-date:${amzDate}`,
    `x-amz-target:${opts.amzTarget}`,
    opts.sessionToken ? `x-amz-security-token:${opts.sessionToken}` : null,
  ].filter(Boolean).join("\n") + "\n";
  const signedHeaders = ["content-type", "host", "x-amz-date", "x-amz-target", opts.sessionToken ? "x-amz-security-token" : null]
    .filter(Boolean).join(";");
  const canonical = [opts.method, opts.path, "", canonicalHeaders, signedHeaders, bodyHash].join("\n");
  const scope = `${dateStamp}/${opts.region}/${opts.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  const kDate = createHmac("sha256", `AWS4${opts.secretAccessKey}`).update(dateStamp).digest();
  const kRegion = createHmac("sha256", kDate).update(opts.region).digest();
  const kService = createHmac("sha256", kRegion).update(opts.service).digest();
  const kSigning = createHmac("sha256", kService).update("aws4_request").digest();
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  const auth = `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const headers: Record<string, string> = {
    "content-type": "application/x-amz-json-1.1",
    "x-amz-date": amzDate,
    "x-amz-target": opts.amzTarget,
    "authorization": auth,
  };
  if (opts.sessionToken) headers["x-amz-security-token"] = opts.sessionToken;
  return headers;
}

export class AwsKmsAdapter implements KmsAdapter {
  provider: KmsProvider = "aws_kms"; keyRef: string;
  constructor(keyRef: string) { this.keyRef = keyRef; }
  private async call(target: "Encrypt" | "Decrypt", payload: Record<string, unknown>) {
    const c = await loadCreds("aws_kms", this.keyRef);
    if (!c.access_key_id || !c.secret_access_key || !c.region) missing("access_key_id/secret_access_key/region", "aws_kms");
    const host = `kms.${c.region}.amazonaws.com`;
    const body = JSON.stringify(payload);
    const headers = await sigv4Sign({
      method: "POST", host, path: "/", region: c.region, service: "kms", body,
      accessKeyId: c.access_key_id, secretAccessKey: c.secret_access_key, sessionToken: c.session_token,
      amzTarget: `TrentService.${target}`,
    });
    return await ok(await fetch(`https://${host}/`, { method: "POST", headers, body })).then((r) => r.json());
  }
  async wrap(dek: Uint8Array): Promise<Uint8Array> {
    const r = await this.call("Encrypt", { KeyId: this.keyRef, Plaintext: b64(dek) });
    return fromB64(r.CiphertextBlob);
  }
  async unwrap(wrapped: Uint8Array): Promise<Uint8Array> {
    const r = await this.call("Decrypt", { CiphertextBlob: b64(wrapped), KeyId: this.keyRef });
    return fromB64(r.Plaintext);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Azure Key Vault — OAuth2 client_credentials → wrapKey / unwrapKey
// creds: { tenant_id, client_id, client_secret }
// keyRef: full vault URL e.g. https://myvault.vault.azure.net/keys/mykey/<version>
// ═══════════════════════════════════════════════════════════════════════════
const _azureTokenCache = new Map<string, { token: string; exp: number }>();
async function azureToken(c: Record<string, string>): Promise<string> {
  const k = `${c.tenant_id}:${c.client_id}`;
  const cached = _azureTokenCache.get(k);
  if (cached && cached.exp > Date.now() + 30_000) return cached.token;
  const body = new URLSearchParams({
    grant_type: "client_credentials", client_id: c.client_id, client_secret: c.client_secret,
    scope: "https://vault.azure.net/.default",
  });
  const r = await ok(await fetch(`https://login.microsoftonline.com/${c.tenant_id}/oauth2/v2.0/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
  })).then((x) => x.json());
  _azureTokenCache.set(k, { token: r.access_token, exp: Date.now() + (r.expires_in ?? 3600) * 1000 });
  return r.access_token;
}
export class AzureKeyVaultAdapter implements KmsAdapter {
  provider: KmsProvider = "azure_kv"; keyRef: string;
  constructor(keyRef: string) { this.keyRef = keyRef; }
  private async call(op: "wrapkey" | "unwrapkey", value: Uint8Array) {
    const c = await loadCreds("azure_kv", this.keyRef);
    if (!c.tenant_id || !c.client_id || !c.client_secret) missing("tenant_id/client_id/client_secret", "azure_kv");
    const token = await azureToken(c);
    const url = `${this.keyRef.replace(/\/+$/, "")}/${op}?api-version=7.4`;
    const r = await ok(await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ alg: "RSA-OAEP-256", value: b64url(value) }),
    })).then((x) => x.json());
    return fromB64url(r.value);
  }
  wrap(dek: Uint8Array) { return this.call("wrapkey", dek); }
  unwrap(wrapped: Uint8Array) { return this.call("unwrapkey", wrapped); }
}

// ═══════════════════════════════════════════════════════════════════════════
// GCP KMS — JWT bearer (RS256) → encrypt / decrypt
// creds: { client_email, private_key, project_id }
// keyRef: projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k>
// ═══════════════════════════════════════════════════════════════════════════
async function importGcpPrivateKey(pem: string): Promise<CryptoKey> {
  const clean = pem.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s+/g, "");
  const der = fromB64(clean);
  return crypto.subtle.importKey("pkcs8", der as BufferSource,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}
const _gcpTokenCache = new Map<string, { token: string; exp: number }>();
async function gcpToken(c: Record<string, string>): Promise<string> {
  const cached = _gcpTokenCache.get(c.client_email);
  if (cached && cached.exp > Date.now() + 30_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: c.client_email, scope: "https://www.googleapis.com/auth/cloudkms",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 };
  const header = { alg: "RS256", typ: "JWT" };
  const unsigned = `${b64url(utf8(JSON.stringify(header)))}.${b64url(utf8(JSON.stringify(claims)))}`;
  const key = await importGcpPrivateKey(c.private_key);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, utf8(unsigned) as BufferSource));
  const jwt = `${unsigned}.${b64url(sig)}`;
  const r = await ok(await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  })).then((x) => x.json());
  _gcpTokenCache.set(c.client_email, { token: r.access_token, exp: Date.now() + (r.expires_in ?? 3600) * 1000 });
  return r.access_token;
}
export class GcpKmsAdapter implements KmsAdapter {
  provider: KmsProvider = "gcp_kms"; keyRef: string;
  constructor(keyRef: string) { this.keyRef = keyRef; }
  private async call(op: "encrypt" | "decrypt", value: Uint8Array) {
    const c = await loadCreds("gcp_kms", this.keyRef);
    if (!c.client_email || !c.private_key) missing("client_email/private_key (service account JSON)", "gcp_kms");
    const token = await gcpToken(c);
    const url = `https://cloudkms.googleapis.com/v1/${this.keyRef}:${op}`;
    const field = op === "encrypt" ? "plaintext" : "ciphertext";
    const r = await ok(await fetch(url, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ [field]: b64(value) }),
    })).then((x) => x.json());
    return fromB64(op === "encrypt" ? r.ciphertext : r.plaintext);
  }
  wrap(dek: Uint8Array) { return this.call("encrypt", dek); }
  unwrap(wrapped: Uint8Array) { return this.call("decrypt", wrapped); }
}

// ═══════════════════════════════════════════════════════════════════════════
// HashiCorp Vault Transit — /v1/transit/encrypt/:name & /decrypt/:name
// creds: { address, token, namespace? }
// keyRef: transit key name (e.g. "fvi-app-kek")
// ═══════════════════════════════════════════════════════════════════════════
export class HashiCorpVaultAdapter implements KmsAdapter {
  provider: KmsProvider = "hashicorp_vault"; keyRef: string;
  constructor(keyRef: string) { this.keyRef = keyRef; }
  private async call(op: "encrypt" | "decrypt", value: Uint8Array | string) {
    const c = await loadCreds("hashicorp_vault", this.keyRef);
    if (!c.address || !c.token) missing("address/token", "hashicorp_vault");
    const url = `${c.address.replace(/\/+$/, "")}/v1/transit/${op}/${encodeURIComponent(this.keyRef)}`;
    const body = op === "encrypt"
      ? { plaintext: b64(value as Uint8Array) }
      : { ciphertext: value as string };
    const headers: Record<string, string> = { "content-type": "application/json", "x-vault-token": c.token };
    if (c.namespace) headers["x-vault-namespace"] = c.namespace;
    const r = await ok(await fetch(url, { method: "POST", headers, body: JSON.stringify(body) })).then((x) => x.json());
    return op === "encrypt" ? r.data.ciphertext as string : fromB64(r.data.plaintext);
  }
  async wrap(dek: Uint8Array): Promise<Uint8Array> {
    const ct = (await this.call("encrypt", dek)) as string; // "vault:v1:…"
    return utf8(ct);
  }
  async unwrap(wrapped: Uint8Array): Promise<Uint8Array> {
    const ct = new TextDecoder().decode(wrapped);
    return (await this.call("decrypt", ct)) as Uint8Array;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CyberArk Conjur — API-key → short-lived token → variable/{account}/variable/{id}
// Conjur has no native wrap/unwrap; we use it as a KEK store: it holds a
// 32-byte master key which we then use for local AES-GCM wrapping. This gives
// us external-vault custody of the KEK while keeping wrap latency low.
// creds: { address, account, login, api_key, kek_variable }
// keyRef: variable path e.g. "fvi/app/kek"
// ═══════════════════════════════════════════════════════════════════════════
const _conjurTokenCache = new Map<string, { token: string; exp: number }>();
async function conjurToken(c: Record<string, string>): Promise<string> {
  const k = `${c.address}:${c.login}`;
  const cached = _conjurTokenCache.get(k);
  if (cached && cached.exp > Date.now() + 30_000) return cached.token;
  const r = await ok(await fetch(`${c.address.replace(/\/+$/, "")}/authn/${encodeURIComponent(c.account)}/${encodeURIComponent(c.login)}/authenticate`, {
    method: "POST", headers: { "content-type": "text/plain", "accept-encoding": "base64" }, body: c.api_key,
  }));
  const token = await r.text();
  _conjurTokenCache.set(k, { token, exp: Date.now() + 6 * 60_000 }); // Conjur tokens ~8min
  return token;
}
const _conjurKekCache = new Map<string, CryptoKey>();
async function conjurKek(keyRef: string): Promise<CryptoKey> {
  if (_conjurKekCache.has(keyRef)) return _conjurKekCache.get(keyRef)!;
  const c = await loadCreds("cyberark_conjur", keyRef);
  if (!c.address || !c.account || !c.login || !c.api_key) missing("address/account/login/api_key", "cyberark_conjur");
  const tok = await conjurToken(c);
  const varId = c.kek_variable ?? keyRef;
  const url = `${c.address.replace(/\/+$/, "")}/secrets/${encodeURIComponent(c.account)}/variable/${encodeURIComponent(varId)}`;
  const r = await ok(await fetch(url, { headers: { authorization: `Token token="${tok}"` } }));
  const raw = new Uint8Array(await r.arrayBuffer());
  // Accept either 32-byte raw or hex/base64 encoded — normalize to 32 bytes.
  let material: Uint8Array = raw;
  if (raw.length !== 32) {
    const s = new TextDecoder().decode(raw).trim();
    if (/^[0-9a-fA-F]{64}$/.test(s)) {
      material = new Uint8Array(32);
      for (let i = 0; i < 32; i++) material[i] = parseInt(s.substr(i * 2, 2), 16);
    } else {
      material = fromB64(s);
    }
  }
  if (material.length !== 32) throw new Error("[vault:cyberark_conjur] KEK variable must be 32 raw bytes (or 64 hex / base64 of 32 bytes)");
  const key = await crypto.subtle.importKey("raw", material as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  _conjurKekCache.set(keyRef, key);
  return key;
}
export class CyberArkConjurAdapter implements KmsAdapter {
  provider: KmsProvider = "cyberark_conjur"; keyRef: string;
  constructor(keyRef: string) { this.keyRef = keyRef; }
  async wrap(dek: Uint8Array): Promise<Uint8Array> {
    const key = await conjurKek(this.keyRef);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, dek as BufferSource));
    const out = new Uint8Array(iv.length + ct.length); out.set(iv, 0); out.set(ct, iv.length);
    return out;
  }
  async unwrap(wrapped: Uint8Array): Promise<Uint8Array> {
    const key = await conjurKek(this.keyRef);
    const iv = wrapped.slice(0, 12), ct = wrapped.slice(12);
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct as BufferSource));
  }
}
