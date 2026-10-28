// ─────────────────────────────────────────────────────────────────────────────
// Vault Resolver — the single choke point that turns a secret reference
// (name + scope) into a plaintext value at runtime.
//
// Resolution is VAULT-ONLY. There is no Cloud Secret / process.env fallback.
// Secrets live exclusively inside the app (app_vault_secrets), envelope-
// encrypted (AES-GCM DEK wrapped by KEK), with SHA-256 fingerprint + last-4
// persisted alongside for identification. Plaintext is never stored, never
// logged, and never returned by list endpoints.
//
// Every call is scope-checked by RLS via the passed-in supabase client
// (must be the authenticated request client, NOT service_role) — meaning a
// caller can only resolve secrets it is already authorised to see.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, pgByteaToBytes } from "./vault.server";

export interface ResolvedSecret {
  plaintext: string;
  source: "vault";
  fingerprint_sha256?: string;
  last4?: string;
}

export async function resolveVaultSecret(
  supabase: SupabaseClient,
  args: {
    scope: "platform" | "tenant";
    tenant_id?: string | null;
    secret_class: "llm_api_key" | "integration_token" | "webhook_secret" | "signing_key" | "kms_credential" | "generic";
    name: string;
    /** @deprecated Cloud Secret fallback removed. Field kept for call-site compatibility; ignored. */
    env_fallback?: string;
  },
): Promise<ResolvedSecret | null> {
  let q = supabase.from("app_vault_secrets")
    .select("ciphertext, iv, auth_tag, wrapped_dek, kek_provider, kek_ref, fingerprint_sha256, last4")
    .eq("scope", args.scope).eq("secret_class", args.secret_class).eq("name", args.name);
  if (args.scope === "tenant") {
    if (!args.tenant_id) throw new Error("tenant_id required for tenant scope");
    q = q.eq("tenant_id", args.tenant_id);
  } else {
    q = q.is("tenant_id", null);
  }
  const { data: row } = await q.maybeSingle();
  if (!row) return null;

  const r: any = row;
  try {
    const pt = await decryptSecret({
      ciphertext: pgByteaToBytes(r.ciphertext),
      iv: pgByteaToBytes(r.iv),
      auth_tag: pgByteaToBytes(r.auth_tag),
      wrapped_dek: pgByteaToBytes(r.wrapped_dek),
      kek_provider: r.kek_provider,
      kek_ref: r.kek_ref,
    });
    // Audit the read (no plaintext, fingerprint + last-4 only). Best-effort
    // and non-blocking — a failed audit insert must not stop resolution.
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from("audit_log").insert({
        actor_user_id: user?.id ?? null,
        tenant_id: args.scope === "tenant" ? args.tenant_id ?? null : null,
        scope: args.scope,
        action: "vault.secret.read",
        resource_type: "app_vault_secret",
        context: {
          secret_class: args.secret_class, name: args.name,
          fingerprint_sha256: r.fingerprint_sha256, last4: r.last4,
          kek_provider: r.kek_provider,
        },
      } as any);
    } catch { /* audit best-effort */ }
    return { plaintext: pt, source: "vault", fingerprint_sha256: r.fingerprint_sha256, last4: r.last4 };
  } catch (e: any) {
    throw new Error(`[vault] decrypt failed for ${args.name}: ${e?.message ?? "unknown"}`);
  }
}

