// ─────────────────────────────────────────────────────────────────────────────
// One-shot migration: read LLM_* Cloud env vars server-side and write them
// into app_vault_secrets as envelope-encrypted rows. Platform-admin only.
// Idempotent: re-running rotates the existing secret to the current env value.
// ─────────────────────────────────────────────────────────────────────────────
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function isPlatformAdmin(ctx: any) {
  const { data } = await ctx.supabase.rpc("is_platform_admin", { _user_id: ctx.userId });
  return !!data;
}

type Target = {
  env: string;
  scope: "platform" | "tenant";
  tenant_id: string | null;
  name: string; // stored vault name (matches llm_providers.key_secret_name lookups)
};

// Enumerate LLM_PLATFORM_* / LLM_TENANT_* env vars and mirror them to vault.
// For tenant secrets we store BOTH the hyphen and underscore-normalized names
// (whichever key_secret_name the provider row references will resolve).
function enumerateTargets(): Target[] {
  const out: Target[] = [];
  for (const [key, val] of Object.entries(process.env)) {
    if (!val) continue;
    if (key.startsWith("LLM_PLATFORM_")) {
      out.push({ env: key, scope: "platform", tenant_id: null, name: key });
      continue;
    }
    const m = key.match(/^LLM_TENANT_(.+)_([A-Z0-9]+)$/);
    if (!m) continue;
    // Reconstruct the tenant UUID: everything between LLM_TENANT_ and _<PROVIDER>
    const idPart = m[1];
    // Accept both hyphenated and underscore variants; canonical UUID uses hyphens.
    const uuid = idPart.includes("-")
      ? idPart
      : idPart.replace(/^([0-9a-f]{8})_([0-9a-f]{4})_([0-9a-f]{4})_([0-9a-f]{4})_([0-9a-f]{12})$/i, "$1-$2-$3-$4-$5");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) continue;
    out.push({ env: key, scope: "tenant", tenant_id: uuid, name: key });
  }
  return out;
}

export const migrateEnvSecretsToVault = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    if (!(await isPlatformAdmin(context))) throw new Error("Forbidden");
    const { encryptSecret, bytesToPgHex, getAdapter } = await import("./vault.server");

    const targets = enumerateTargets();
    const results: Array<{ env: string; scope: string; tenant_id: string | null; name: string; action: "created" | "rotated" | "skipped"; last4?: string; fingerprint?: string; error?: string }> = [];

    for (const t of targets) {
      const plaintext = process.env[t.env];
      if (!plaintext) { results.push({ ...t, action: "skipped", error: "empty" }); continue; }
      try {
        // Pick default KMS binding for this scope (fallback to meta_managed).
        let provider: "meta_managed" | "aws_kms" | "gcp_kms" | "azure_kv" = "meta_managed";
        let keyRef = "APP_DATA_ENC_KEY";
        let bq = context.supabase
          .from("app_vault_kms_bindings")
          .select("provider, key_ref").eq("scope", t.scope)
          .eq("is_default", true).eq("status", "active");
        bq = t.scope === "tenant" ? bq.eq("tenant_id", t.tenant_id!) : bq.is("tenant_id", null);
        const { data: bind } = await bq.maybeSingle();
        if (bind) { provider = (bind as any).provider; keyRef = (bind as any).key_ref; }
        const adapter = getAdapter(provider, keyRef);
        const enc = await encryptSecret(plaintext, adapter);

        // Look for an existing row on (scope, tenant_id, secret_class, name).
        let selQ = context.supabase.from("app_vault_secrets")
          .select("id, version, fingerprint_sha256")
          .eq("scope", t.scope).eq("secret_class", "llm_api_key").eq("name", t.name);
        selQ = t.scope === "tenant" ? selQ.eq("tenant_id", t.tenant_id!) : selQ.is("tenant_id", null);
        const { data: existing } = await selQ.maybeSingle();

        const row: any = {
          scope: t.scope,
          tenant_id: t.scope === "tenant" ? t.tenant_id : null,
          secret_class: "llm_api_key",
          name: t.name,
          ciphertext: bytesToPgHex(enc.ciphertext),
          iv: bytesToPgHex(enc.iv),
          auth_tag: bytesToPgHex(enc.auth_tag),
          wrapped_dek: bytesToPgHex(enc.wrapped_dek),
          kek_provider: enc.kek_provider,
          kek_ref: enc.kek_ref,
          fingerprint_sha256: enc.fingerprint_sha256,
          last4: enc.last4,
          created_by: context.userId,
        };

        let id: string;
        let action: "created" | "rotated";
        if (existing) {
          row.version = ((existing as any).version ?? 1) + 1;
          row.rotated_at = new Date().toISOString();
          const { data: r, error } = await context.supabase
            .from("app_vault_secrets").update(row).eq("id", (existing as any).id).select("id, version").single();
          if (error) throw new Error(error.message);
          id = r!.id; action = "rotated";
          await context.supabase.from("app_vault_rotation_log").insert({
            secret_id: id, rotated_by: context.userId,
            from_version: (existing as any).version ?? 1, to_version: r!.version,
            from_fingerprint: (existing as any).fingerprint_sha256, to_fingerprint: enc.fingerprint_sha256,
            kek_provider: enc.kek_provider, kek_ref: enc.kek_ref,
            reason: "env→vault migration",
          } as any);
        } else {
          const { data: r, error } = await context.supabase
            .from("app_vault_secrets").insert(row).select("id").single();
          if (error) throw new Error(error.message);
          id = r!.id; action = "created";
        }

        await context.supabase.from("audit_log").insert({
          actor_user_id: context.userId,
          tenant_id: t.scope === "tenant" ? t.tenant_id : null,
          scope: t.scope,
          action: action === "created" ? "vault.secret.create" : "vault.secret.rotate",
          resource_type: "app_vault_secret", resource_id: id,
          context: {
            secret_class: "llm_api_key", name: t.name,
            source: "env_migration", env_var: t.env,
            kek_provider: enc.kek_provider, kek_ref: enc.kek_ref,
            fingerprint_sha256: enc.fingerprint_sha256, last4: enc.last4,
          },
        } as any);
        results.push({ ...t, action, last4: enc.last4, fingerprint: enc.fingerprint_sha256 });
      } catch (e: any) {
        results.push({ ...t, action: "skipped", error: e?.message ?? String(e) });
      }
    }
    return { count: results.length, results };
  });
