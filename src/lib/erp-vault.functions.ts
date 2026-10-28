/**
 * ERP Credential Vault — server functions.
 *
 * Stores per-auth-method credential JSON in `public.app_vault_secrets` under
 * envelope encryption (AES-256-GCM with a random per-secret DEK wrapped by the
 * platform KEK — see `src/lib/vault.server.ts`). Raw secrets never round-trip
 * back to the browser; this module only returns metadata (name, last4,
 * fingerprint, created_at, class) plus the vault secret id used as
 * `credential_vault_secret_id` on `erp_connector_configs`.
 *
 * Every mutation is guarded by `tenant_admin` (or platform_admin) on the
 * target tenant and logged to `audit_log`.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantAdmin } from "@/lib/rbac-guards.server";
import { z } from "zod";

// ── Credential payload schema per auth method ────────────────────────────────
export const CREDENTIAL_SCHEMAS = {
  oauth2: z.object({
    kind: z.literal("oauth2"),
    grant_type: z.enum(["client_credentials", "authorization_code", "refresh_token"])
      .default("client_credentials"),
    client_id: z.string().min(1).max(512),
    client_secret: z.string().min(1).max(4096),
    token_url: z.string().url().max(1024),
    scopes: z.array(z.string().max(256)).max(32).default([]),
    refresh_token: z.string().max(4096).optional(),
    extra_params: z.record(z.string().max(1024)).optional(),
  }),
  api_key: z.object({
    kind: z.literal("api_key"),
    header_name: z.string().min(1).max(128).default("Authorization"),
    header_prefix: z.string().max(32).default("Bearer"),
    api_key: z.string().min(1).max(4096),
  }),
  basic: z.object({
    kind: z.literal("basic"),
    username: z.string().min(1).max(256),
    password: z.string().min(1).max(1024),
  }),
  service_account: z.object({
    kind: z.literal("service_account"),
    // Full JSON key from the ERP vendor (SAP tech user, Oracle sa, Finacle SA)
    json: z.string().min(20).max(16384),
    token_url: z.string().url().max(1024).optional(),
    scopes: z.array(z.string().max(256)).max(32).default([]),
  }),
  ssh_key: z.object({
    kind: z.literal("ssh_key"),
    username: z.string().max(128).optional(),
    private_key: z.string().min(20).max(16384),
    passphrase: z.string().max(512).optional(),
    known_hosts: z.string().max(8192).optional(),
  }),
} as const;

export const CredentialPayloadSchema = z.discriminatedUnion("kind", [
  CREDENTIAL_SCHEMAS.oauth2,
  CREDENTIAL_SCHEMAS.api_key,
  CREDENTIAL_SCHEMAS.basic,
  CREDENTIAL_SCHEMAS.service_account,
  CREDENTIAL_SCHEMAS.ssh_key,
]);

export type CredentialPayload = z.infer<typeof CredentialPayloadSchema>;

// ── RBAC helper (duplicated from erp-connectors.functions to avoid cross-import) ─
async function assertTenantAdmin(supabase: any, userId: string, tenantId: string) {
  await requireTenantAdmin({ supabase, userId } as any, tenantId, { fnName: "erp-vault" });
}

// ── List (metadata only — never plaintext) ───────────────────────────────────
export const listErpVaultSecrets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context.supabase, context.userId, data.tenant_id);
    const { data: rows, error } = await context.supabase
      .from("app_vault_secrets")
      .select("id, name, secret_class, last4, fingerprint_sha256, version, created_at, rotated_at, kek_provider")
      .eq("scope", "tenant")
      .eq("tenant_id", data.tenant_id)
      .eq("secret_class", "integration_token")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { secrets: rows ?? [] };
  });

// ── Create or rotate ─────────────────────────────────────────────────────────
export const saveErpVaultSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      name: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.:-]+$/, "letters, digits, . _ - : only"),
      credential: CredentialPayloadSchema,
      rotate_existing_id: z.string().uuid().optional(),
      reason: z.string().max(500).optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context.supabase, context.userId, data.tenant_id);
    const { encryptSecret, bytesToPgHex } = await import("@/lib/vault.server");
    const plaintext = JSON.stringify(data.credential);
    const enc = await encryptSecret(plaintext);
    const last4 = enc.last4;

    const commonPayload = {
      scope: "tenant" as const,
      tenant_id: data.tenant_id,
      secret_class: "integration_token" as const,
      name: data.name,
      ciphertext: bytesToPgHex(enc.ciphertext),
      iv: bytesToPgHex(enc.iv),
      auth_tag: bytesToPgHex(enc.auth_tag),
      wrapped_dek: bytesToPgHex(enc.wrapped_dek),
      kek_provider: enc.kek_provider,
      kek_ref: enc.kek_ref,
      fingerprint_sha256: enc.fingerprint_sha256,
      last4,
      created_by: context.userId,
    };

    let row: any;
    let action: string;
    let fromVersion = 0;
    let fromFingerprint = "";
    if (data.rotate_existing_id) {
      const { data: existing, error: exErr } = await context.supabase
        .from("app_vault_secrets")
        .select("id, tenant_id, version, fingerprint_sha256")
        .eq("id", data.rotate_existing_id)
        .single();
      if (exErr || !existing) throw new Error("Secret to rotate not found");
      if ((existing as any).tenant_id !== data.tenant_id) throw new Error("Tenant mismatch");
      fromVersion = (existing as any).version ?? 1;
      fromFingerprint = (existing as any).fingerprint_sha256 ?? "";

      const { data: updated, error } = await context.supabase
        .from("app_vault_secrets")
        .update({
          ...commonPayload,
          version: fromVersion + 1,
          rotated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", data.rotate_existing_id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      row = updated;
      action = "vault.secret.rotated";

      await context.supabase.from("app_vault_rotation_log").insert({
        secret_id: (row as any).id,
        rotated_by: context.userId,
        from_version: fromVersion,
        to_version: fromVersion + 1,
        from_fingerprint: fromFingerprint,
        to_fingerprint: enc.fingerprint_sha256,
        reason: data.reason ?? null,
      } as never);
    } else {
      const { data: inserted, error } = await context.supabase
        .from("app_vault_secrets")
        .insert(commonPayload as never)
        .select()
        .single();
      if (error) throw new Error(error.message);
      row = inserted;
      action = "vault.secret.created";
    }

    // Immutable history row.
    await context.supabase.from("app_vault_secret_versions").insert({
      secret_id: (row as any).id,
      scope: "tenant",
      tenant_id: data.tenant_id,
      secret_class: "integration_token",
      name: data.name,
      version: (row as any).version,
      ciphertext: bytesToPgHex(enc.ciphertext),
      iv: bytesToPgHex(enc.iv),
      auth_tag: bytesToPgHex(enc.auth_tag),
      wrapped_dek: bytesToPgHex(enc.wrapped_dek),
      kek_provider: enc.kek_provider,
      kek_ref: enc.kek_ref,
      fingerprint_sha256: enc.fingerprint_sha256,
      last4,
      change_kind: data.rotate_existing_id ? "rotate" : "create",
      reason: data.reason ?? null,
      created_by: context.userId,
    } as never);

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "tenant",
      action,
      resource_type: "app_vault_secret",
      resource_id: (row as any).id,
      context: {
        name: data.name,
        auth_kind: data.credential.kind,
        version: (row as any).version,
        fingerprint_sha256: enc.fingerprint_sha256,
        last4,
      },
    } as never);

    return {
      secret_id: (row as any).id,
      name: (row as any).name,
      version: (row as any).version,
      last4,
      fingerprint_sha256: enc.fingerprint_sha256,
    };
  });

// ── Delete ───────────────────────────────────────────────────────────────────
export const deleteErpVaultSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    secret_id: z.string().uuid(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context.supabase, context.userId, data.tenant_id);
    // Detach any connectors referencing this secret before delete.
    await context.supabase
      .from("erp_connector_configs")
      .update({ credential_vault_secret_id: null } as never)
      .eq("tenant_id", data.tenant_id)
      .eq("credential_vault_secret_id", data.secret_id);
    const { error } = await context.supabase
      .from("app_vault_secrets")
      .delete()
      .eq("id", data.secret_id)
      .eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: "vault.secret.deleted",
      resource_type: "app_vault_secret",
      resource_id: data.secret_id,
      context: {},
    } as never);
    return { ok: true };
  });

// ── Test credential against a target base URL ────────────────────────────────
export const testErpVaultCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    secret_id: z.string().uuid(),
    base_url: z.string().url().max(2048).optional(),
    probe_path: z.string().max(1024).default("/"),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context.supabase, context.userId, data.tenant_id);
    const { data: rec, error } = await context.supabase
      .from("app_vault_secrets")
      .select("id, tenant_id, ciphertext, iv, auth_tag, wrapped_dek, kek_provider, kek_ref, last4")
      .eq("id", data.secret_id)
      .eq("tenant_id", data.tenant_id)
      .single();
    if (error || !rec) throw new Error("Secret not found.");

    const { decryptSecret, pgByteaToBytes } = await import("@/lib/vault.server");
    let credential: CredentialPayload;
    try {
      const pt = await decryptSecret({
        ciphertext: pgByteaToBytes((rec as any).ciphertext),
        iv: pgByteaToBytes((rec as any).iv),
        auth_tag: pgByteaToBytes((rec as any).auth_tag),
        wrapped_dek: pgByteaToBytes((rec as any).wrapped_dek),
        kek_provider: (rec as any).kek_provider,
        kek_ref: (rec as any).kek_ref,
      });
      credential = CredentialPayloadSchema.parse(JSON.parse(pt));
    } catch (e: any) {
      throw new Error(`Vault decrypt failed: ${e?.message ?? "unknown"}`);
    }

    const start = Date.now();
    const result: {
      ok: boolean;
      stage: "decrypt" | "token" | "probe";
      message: string;
      latency_ms?: number;
      http_status?: number;
      token_acquired?: boolean;
    } = { ok: false, stage: "decrypt", message: "no probe run" };

    const fetchWithTimeout = async (url: string, init: RequestInit, ms = 8000) => {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), ms);
      try { return await fetch(url, { ...init, signal: ctl.signal }); }
      finally { clearTimeout(t); }
    };

    try {
      const auth: { header?: [string, string] } = {};
      let tokenAcquired = false;

      if (credential.kind === "oauth2") {
        // client_credentials handshake to token_url.
        const body = new URLSearchParams({
          grant_type: credential.grant_type,
          client_id: credential.client_id,
          client_secret: credential.client_secret,
          ...(credential.scopes.length ? { scope: credential.scopes.join(" ") } : {}),
          ...(credential.extra_params ?? {}),
        });
        result.stage = "token";
        const r = await fetchWithTimeout(credential.token_url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body,
        });
        result.http_status = r.status;
        if (!r.ok) {
          result.message = `Token endpoint returned HTTP ${r.status}`;
          result.latency_ms = Date.now() - start;
          throw new Error(result.message);
        }
        const tok = await r.json().catch(() => ({} as any));
        const access = (tok as any).access_token as string | undefined;
        if (!access) { result.message = "Token endpoint returned no access_token"; throw new Error(result.message); }
        tokenAcquired = true;
        auth.header = ["Authorization", `Bearer ${access}`];
      } else if (credential.kind === "api_key") {
        const value = credential.header_prefix
          ? `${credential.header_prefix} ${credential.api_key}`.trim()
          : credential.api_key;
        auth.header = [credential.header_name, value];
      } else if (credential.kind === "basic") {
        const b64 = btoa(`${credential.username}:${credential.password}`);
        auth.header = ["Authorization", `Basic ${b64}`];
      } else if (credential.kind === "service_account") {
        // Best-effort: validate JSON parses; live token exchange requires vendor SDK.
        try { JSON.parse(credential.json); }
        catch { throw new Error("service_account JSON is not valid JSON"); }
        result.stage = "probe";
        result.message = "Service-account JSON parsed. Live probe requires a token_url; skipping HTTP.";
        if (!data.base_url) { result.ok = true; result.latency_ms = Date.now() - start; return result; }
      } else if (credential.kind === "ssh_key") {
        if (!/BEGIN [A-Z ]*PRIVATE KEY/.test(credential.private_key)) {
          throw new Error("Private key does not look like a PEM block");
        }
        result.stage = "probe";
        result.message = "SSH private key format looks valid. SSH probe from Worker not supported; run from a jump host.";
        result.ok = true; result.latency_ms = Date.now() - start;
        return { ...result, token_acquired: tokenAcquired };
      }

      if (data.base_url) {
        result.stage = "probe";
        const url = new URL(data.probe_path || "/", data.base_url).toString();
        const headers: Record<string, string> = { accept: "application/json" };
        if (auth.header) headers[auth.header[0]] = auth.header[1];
        const r = await fetchWithTimeout(url, { method: "GET", headers });
        result.http_status = r.status;
        result.ok = r.status < 400;
        result.message = result.ok
          ? `Authenticated probe OK (HTTP ${r.status})`
          : `Probe returned HTTP ${r.status}`;
      } else {
        result.ok = true;
        result.message = tokenAcquired
          ? "Token acquired. No base_url supplied — skipped downstream probe."
          : "Credential shape validated. Provide base_url to run a live probe.";
      }
      result.latency_ms = Date.now() - start;
      result.token_acquired = tokenAcquired;
    } catch (e: any) {
      result.ok = false;
      result.latency_ms = Date.now() - start;
      if (!result.message || result.message === "no probe run") {
        result.message = e?.message ?? "Unknown error";
      }
    }

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: "vault.secret.tested",
      resource_type: "app_vault_secret",
      resource_id: data.secret_id,
      context: {
        ok: result.ok,
        stage: result.stage,
        http_status: result.http_status ?? null,
        latency_ms: result.latency_ms ?? null,
        base_url: data.base_url ?? null,
      },
    } as never);

    return result;
  });
