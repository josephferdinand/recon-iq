// ─────────────────────────────────────────────────────────────────────────────
// Vault server functions — CRUD + rotation for encrypted secrets.
// Callable from Platform Admin (scope=platform) and Tenant Admin (scope=tenant).
// ─────────────────────────────────────────────────────────────────────────────
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createErrorReference, USER_FACING_ERRORS } from "./user-facing-errors";

function vaultServiceError(error: unknown): Error {
  const referenceId = createErrorReference();
  const detail = error && typeof error === "object" ? error as Record<string, unknown> : {};
  console.error("[VAULT_SERVICE_ERROR]", {
    referenceId,
    code: typeof detail.code === "string" ? detail.code : undefined,
  });
  const copy = USER_FACING_ERRORS.service;
  return new Error(`${copy.message} ${copy.action} Error Reference ID: ${referenceId}`);
}

const SecretClass = z.enum([
  "llm_api_key", "integration_token", "webhook_secret", "signing_key", "kms_credential", "generic",
]);

async function isPlatformAdmin(ctx: any) {
  const { data, error } = await ctx.supabase.rpc("is_platform_admin", { _user_id: ctx.userId });
  if (error) throw vaultServiceError(error);
  return !!data;
}
async function isTenantAdmin(ctx: any, tenantId: string) {
  const { data, error } = await ctx.supabase.rpc("has_tenant_role", {
    _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_admin",
  });
  if (error) throw vaultServiceError(error);
  return !!data;
}
async function assertScope(ctx: any, scope: "platform" | "tenant", tenantId?: string | null) {
  if (scope === "platform") {
    if (!(await isPlatformAdmin(ctx))) throw new Error("Forbidden");
    return;
  }
  if (!tenantId) throw new Error("tenant_id required");
  if (!(await isTenantAdmin(ctx, tenantId)) && !(await isPlatformAdmin(ctx))) throw new Error("Forbidden");
}

// LIST — never returns plaintext, only metadata + fingerprint + last4.
export const listVaultSecrets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      scope: z.enum(["platform", "tenant"]),
      tenant_id: z.string().uuid().optional(),
      secret_class: SecretClass.optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertScope(context, data.scope, data.tenant_id ?? null);
    let q = context.supabase
      .from("app_vault_secrets")
      .select("id, scope, tenant_id, secret_class, name, fingerprint_sha256, last4, kek_provider, kek_ref, version, created_at, updated_at, rotated_at")
      .eq("scope", data.scope);
    if (data.scope === "tenant") q = q.eq("tenant_id", data.tenant_id!);
    else q = q.is("tenant_id", null);
    if (data.secret_class) q = q.eq("secret_class", data.secret_class);
    const { data: rows, error } = await q.order("secret_class").order("name");
    if (error) throw vaultServiceError(error);
    return rows ?? [];
  });

// PUT (create or rotate). Encrypts server-side and stores envelope.
export const putVaultSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      scope: z.enum(["platform", "tenant"]),
      tenant_id: z.string().uuid().optional(),
      secret_class: SecretClass,
      name: z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/, "name may contain [A-Za-z0-9_.:-] only"),
      plaintext: z.string().min(1).max(24000),
      reason: z.string().max(500).optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertScope(context, data.scope, data.tenant_id ?? null);
    const { encryptSecret, bytesToPgHex, getAdapter } = await import("./vault.server");

    // Choose adapter — default meta_managed unless a scope-default KMS binding exists.
    let provider: "meta_managed" | "aws_kms" | "gcp_kms" | "azure_kv" = "meta_managed";
    let keyRef = "APP_DATA_ENC_KEY";
    let bq = context.supabase
      .from("app_vault_kms_bindings")
      .select("provider, key_ref").eq("scope", data.scope)
      .eq("is_default", true).eq("status", "active");
    if (data.scope === "tenant") bq = bq.eq("tenant_id", data.tenant_id!);
    else bq = bq.is("tenant_id", null);
    const { data: bind } = await bq.maybeSingle();
    if (bind) { provider = (bind as any).provider; keyRef = (bind as any).key_ref; }
    const adapter = getAdapter(provider, keyRef);
    const enc = await encryptSecret(data.plaintext, adapter);

    // Upsert on (scope,tenant_id,secret_class,name). Read existing to record rotation.
    let selQ = context.supabase.from("app_vault_secrets")
      .select("id, version, fingerprint_sha256")
      .eq("scope", data.scope).eq("secret_class", data.secret_class).eq("name", data.name);
    if (data.scope === "tenant") selQ = selQ.eq("tenant_id", data.tenant_id!);
    else selQ = selQ.is("tenant_id", null);
    const { data: existing } = await selQ.maybeSingle();

    const row: any = {
      scope: data.scope,
      tenant_id: data.scope === "tenant" ? data.tenant_id : null,
      secret_class: data.secret_class,
      name: data.name,
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
    let newVersion: number;
    let fromVersion: number | null = null;
    let fromFingerprint: string | null = null;
    if (existing) {
      fromVersion = (existing as any).version ?? 1;
      fromFingerprint = (existing as any).fingerprint_sha256;
      row.version = fromVersion! + 1;
      row.rotated_at = new Date().toISOString();
      const { data: r, error } = await context.supabase
        .from("app_vault_secrets").update(row).eq("id", (existing as any).id).select("id, version").single();
      if (error) throw vaultServiceError(error);
      id = r!.id;
      newVersion = r!.version;
      await context.supabase.from("app_vault_rotation_log").insert({
        secret_id: id, rotated_by: context.userId,
        from_version: fromVersion, to_version: newVersion,
        from_fingerprint: fromFingerprint, to_fingerprint: enc.fingerprint_sha256,
        kek_provider: enc.kek_provider, kek_ref: enc.kek_ref, reason: data.reason ?? null,
      } as any);
    } else {
      const { data: r, error } = await context.supabase
        .from("app_vault_secrets").insert(row).select("id, version").single();
      if (error) throw vaultServiceError(error);
      id = r!.id;
      newVersion = r!.version;
    }

    // Snapshot the new state to the append-only version history so rollback is possible.
    await context.supabase.from("app_vault_secret_versions").insert({
      secret_id: id,
      version: newVersion,
      scope: row.scope,
      tenant_id: row.tenant_id,
      secret_class: row.secret_class,
      name: row.name,
      ciphertext: row.ciphertext,
      iv: row.iv,
      auth_tag: row.auth_tag,
      wrapped_dek: row.wrapped_dek,
      kek_provider: row.kek_provider,
      kek_ref: row.kek_ref,
      fingerprint_sha256: row.fingerprint_sha256,
      last4: row.last4,
      reason: data.reason ?? null,
      change_kind: existing ? "rotate" : "create",
      created_by: context.userId,
    } as any);

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.scope === "tenant" ? data.tenant_id : null,
      scope: data.scope,
      action: existing ? "vault.secret.rotate" : "vault.secret.create",
      resource_type: "app_vault_secret", resource_id: id,
      context: {
        secret_class: data.secret_class, name: data.name,
        kek_provider: enc.kek_provider, kek_ref: enc.kek_ref,
        fingerprint_sha256: enc.fingerprint_sha256, last4: enc.last4,
        reason: data.reason ?? null,
      },
    } as any);
    return { id };
  });

// DELETE — hard delete; audit-logged.
export const deleteVaultSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: cur } = await context.supabase.from("app_vault_secrets")
      .select("id, scope, tenant_id, secret_class, name, fingerprint_sha256")
      .eq("id", data.id).maybeSingle();
    if (!cur) throw new Error("Not found");
    const c: any = cur;
    await assertScope(context, c.scope, c.tenant_id);
    const { error } = await context.supabase.from("app_vault_secrets").delete().eq("id", data.id);
    if (error) throw vaultServiceError(error);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: c.tenant_id, scope: c.scope,
      action: "vault.secret.delete", resource_type: "app_vault_secret", resource_id: data.id,
      context: { secret_class: c.secret_class, name: c.name, fingerprint_sha256: c.fingerprint_sha256 },
    } as any);
    return { ok: true };
  });

// ROTATION LOG
export const listVaultRotationLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ secret_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.from("app_vault_rotation_log")
      .select("*").eq("secret_id", data.secret_id).order("rotated_at", { ascending: false });
    if (error) throw vaultServiceError(error);
    return rows ?? [];
  });

// SECRET VERSION HISTORY — metadata only; ciphertext never leaves the server.
export const listVaultSecretVersions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ secret_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: sec } = await context.supabase.from("app_vault_secrets")
      .select("id, scope, tenant_id, version").eq("id", data.secret_id).maybeSingle();
    if (!sec) throw new Error("Not found");
    const s: any = sec;
    await assertScope(context, s.scope, s.tenant_id);
    const { data: rows, error } = await context.supabase.from("app_vault_secret_versions")
      .select("id, version, change_kind, fingerprint_sha256, last4, kek_provider, kek_ref, reason, created_by, created_at")
      .eq("secret_id", data.secret_id)
      .order("version", { ascending: false });
    if (error) throw vaultServiceError(error);
    return { current_version: s.version as number, versions: rows ?? [] };
  });

// ROLLBACK — restore a prior version's DEK envelope as the live secret.
// The wrapped_dek + ciphertext are copied verbatim; no plaintext is ever handled.
export const rollbackVaultSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    secret_id: z.string().uuid(),
    target_version: z.number().int().positive(),
    reason: z.string().min(3).max(500),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: sec } = await context.supabase.from("app_vault_secrets")
      .select("id, scope, tenant_id, secret_class, name, version, fingerprint_sha256")
      .eq("id", data.secret_id).maybeSingle();
    if (!sec) throw new Error("Not found");
    const s: any = sec;
    await assertScope(context, s.scope, s.tenant_id);
    if (data.target_version === s.version) throw new Error("Target version is already current");

    const { data: tgt, error: tErr } = await context.supabase.from("app_vault_secret_versions")
      .select("ciphertext, iv, auth_tag, wrapped_dek, kek_provider, kek_ref, fingerprint_sha256, last4")
      .eq("secret_id", data.secret_id).eq("version", data.target_version).maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!tgt) throw new Error(`Version ${data.target_version} not found in history`);
    const t: any = tgt;

    // Optional guardrail: block rollback if the target's KEK binding is no longer active.
    if (t.kek_provider !== "meta_managed") {
      let bq = context.supabase.from("app_vault_kms_bindings")
        .select("id, status").eq("scope", s.scope)
        .eq("provider", t.kek_provider).eq("key_ref", t.kek_ref);
      if (s.scope === "tenant") bq = bq.eq("tenant_id", s.tenant_id);
      else bq = bq.is("tenant_id", null);
      const { data: bind } = await bq.maybeSingle();
      if (!bind || (bind as any).status !== "active") {
        throw new Error(`KMS binding for ${t.kek_provider}:${t.kek_ref} is not active — restore/re-activate it before rolling back.`);
      }
    }

    const newVersion = s.version + 1;
    const nowIso = new Date().toISOString();

    const { error: uErr } = await context.supabase.from("app_vault_secrets").update({
      ciphertext: t.ciphertext,
      iv: t.iv,
      auth_tag: t.auth_tag,
      wrapped_dek: t.wrapped_dek,
      kek_provider: t.kek_provider,
      kek_ref: t.kek_ref,
      fingerprint_sha256: t.fingerprint_sha256,
      last4: t.last4,
      version: newVersion,
      rotated_at: nowIso,
      updated_at: nowIso,
    }).eq("id", data.secret_id);
    if (uErr) throw new Error(uErr.message);

    await context.supabase.from("app_vault_secret_versions").insert({
      secret_id: data.secret_id,
      version: newVersion,
      scope: s.scope,
      tenant_id: s.tenant_id,
      secret_class: s.secret_class,
      name: s.name,
      ciphertext: t.ciphertext,
      iv: t.iv,
      auth_tag: t.auth_tag,
      wrapped_dek: t.wrapped_dek,
      kek_provider: t.kek_provider,
      kek_ref: t.kek_ref,
      fingerprint_sha256: t.fingerprint_sha256,
      last4: t.last4,
      reason: `rollback to v${data.target_version}: ${data.reason}`,
      change_kind: "rollback",
      created_by: context.userId,
    } as any);

    await context.supabase.from("app_vault_rotation_log").insert({
      secret_id: data.secret_id, rotated_by: context.userId,
      from_version: s.version, to_version: newVersion,
      from_fingerprint: s.fingerprint_sha256, to_fingerprint: t.fingerprint_sha256,
      kek_provider: t.kek_provider, kek_ref: t.kek_ref,
      reason: `rollback to v${data.target_version}: ${data.reason}`,
    } as any);

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: s.tenant_id, scope: s.scope,
      action: "vault.secret.rollback", resource_type: "app_vault_secret", resource_id: data.secret_id,
      context: {
        secret_class: s.secret_class, name: s.name,
        from_version: s.version, to_version: newVersion, target_version: data.target_version,
        from_fingerprint: s.fingerprint_sha256, to_fingerprint: t.fingerprint_sha256,
        kek_provider: t.kek_provider, kek_ref: t.kek_ref, reason: data.reason,
      },
    } as any);

    return { ok: true, new_version: newVersion, restored_from_version: data.target_version };
  });

// ─── KMS BINDINGS ────────────────────────────────────────────────────────────
export const listKmsBindings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ scope: z.enum(["platform", "tenant"]), tenant_id: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertScope(context, data.scope, data.tenant_id ?? null);
    let q = context.supabase.from("app_vault_kms_bindings")
      .select("id,scope,tenant_id,provider,key_ref,region,is_default,status,last_verified_at,verification_error,created_at,updated_at")
      .eq("scope", data.scope);
    if (data.scope === "tenant") q = q.eq("tenant_id", data.tenant_id!);
    else q = q.is("tenant_id", null);
    const { data: rows, error } = await q.order("created_at", { ascending: false });
    if (error) throw vaultServiceError(error);
    return (rows ?? []).map(({ verification_error, ...row }: any) => ({
      ...row, verification_needs_attention: !!verification_error,
    }));
  });

export const upsertKmsBinding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      scope: z.enum(["platform", "tenant"]),
      tenant_id: z.string().uuid().optional(),
      provider: z.enum(["meta_managed", "aws_kms", "gcp_kms", "azure_kv"]),
      key_ref: z.string().min(1),
      region: z.string().optional().nullable(),
      is_default: z.boolean().default(false),
      status: z.enum(["active", "disabled", "revoked"]).default("active"),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertScope(context, data.scope, data.tenant_id ?? null);
    const patch: any = {
      scope: data.scope,
      tenant_id: data.scope === "tenant" ? data.tenant_id : null,
      provider: data.provider,
      key_ref: data.key_ref,
      region: data.region ?? null,
      is_default: data.is_default,
      status: data.status,
      created_by: context.userId,
    };
    // Enforce single default per scope: clear existing defaults first.
    if (data.is_default) {
      let clr = context.supabase.from("app_vault_kms_bindings").update({ is_default: false })
        .eq("scope", data.scope).eq("is_default", true);
      if (data.scope === "tenant") clr = clr.eq("tenant_id", data.tenant_id!);
      else clr = clr.is("tenant_id", null);
      await clr;
    }
    let id: string;
    if (data.id) {
      const { data: r, error } = await context.supabase.from("app_vault_kms_bindings")
        .update(patch).eq("id", data.id).select("id").single();
      if (error) throw vaultServiceError(error);
      id = r!.id;
    } else {
      const { data: r, error } = await context.supabase.from("app_vault_kms_bindings")
        .insert(patch).select("id").single();
      if (error) throw vaultServiceError(error);
      id = r!.id;
    }
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.scope === "tenant" ? data.tenant_id : null,
      scope: data.scope, action: data.id ? "vault.kms.update" : "vault.kms.create",
      resource_type: "app_vault_kms_binding", resource_id: id,
      context: { provider: data.provider, key_ref: data.key_ref, region: data.region ?? null, is_default: data.is_default, status: data.status },
    } as any);
    return { id };
  });

export const deleteKmsBinding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: cur } = await context.supabase.from("app_vault_kms_bindings")
      .select("scope, tenant_id, provider, key_ref").eq("id", data.id).maybeSingle();
    if (!cur) throw new Error("Not found");
    const c: any = cur;
    await assertScope(context, c.scope, c.tenant_id);
    const { error } = await context.supabase.from("app_vault_kms_bindings").delete().eq("id", data.id);
    if (error) throw vaultServiceError(error);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: c.tenant_id, scope: c.scope,
      action: "vault.kms.delete", resource_type: "app_vault_kms_binding", resource_id: data.id,
      context: { provider: c.provider, key_ref: c.key_ref },
    } as any);
    return { ok: true };
  });

// TEST — verifies a binding by wrapping+unwrapping a 32-byte token.
export const testKmsBinding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: cur } = await context.supabase.from("app_vault_kms_bindings")
      .select("id, scope, tenant_id, provider, key_ref").eq("id", data.id).maybeSingle();
    if (!cur) throw new Error("Not found");
    const c: any = cur;
    await assertScope(context, c.scope, c.tenant_id);
    const { getAdapter } = await import("./vault.server");
    const started = Date.now();
    let ok = false, errorText: string | null = null;
    try {
      const adapter = getAdapter(c.provider, c.key_ref);
      const sample = crypto.getRandomValues(new Uint8Array(32));
      const wrapped = await adapter.wrap(sample);
      const back = await adapter.unwrap(wrapped);
      ok = back.length === sample.length && back.every((b, i) => b === sample[i]);
      if (!ok) errorText = "unwrap did not match original";
    } catch (e: any) {
      errorText = e?.message ?? String(e);
    }
    const latency_ms = Date.now() - started;
    await context.supabase.from("app_vault_kms_bindings").update({
      last_verified_at: new Date().toISOString(),
      verification_error: errorText,
    }).eq("id", data.id);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: c.tenant_id, scope: c.scope,
      action: "vault.kms.test", resource_type: "app_vault_kms_binding", resource_id: c.id,
      context: { ok, latency_ms, error: errorText, provider: c.provider },
    } as any);
    return { ok, latency_ms, verification_needs_attention: !ok };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Access matrix — who can manage vault secrets for the given scope.
// Returns viewer capabilities + list of authorised admins (metadata only).
// Mirrors the RLS policies on app_vault_secrets / app_vault_kms_bindings.
// ─────────────────────────────────────────────────────────────────────────────
export const getVaultAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      scope: z.enum(["platform", "tenant"]),
      tenant_id: z.string().uuid().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const viewerIsPlatformAdmin = await isPlatformAdmin(context);
    const viewerIsTenantAdmin = data.scope === "tenant" && data.tenant_id
      ? await isTenantAdmin(context, data.tenant_id)
      : false;

    const { data: platRows } = await context.supabase
      .from("platform_roles")
      .select("user_id, role, granted_at")
      .eq("role", "platform_admin");
    const platIds = Array.from(new Set((platRows ?? []).map((r: any) => r.user_id)));

    let tenRows: any[] = [];
    let tenIds: string[] = [];
    if (data.scope === "tenant" && data.tenant_id) {
      const { data: rows } = await context.supabase
        .from("tenant_members")
        .select("user_id, role, active, joined_at")
        .eq("tenant_id", data.tenant_id)
        .eq("role", "tenant_admin")
        .eq("active", true);
      tenRows = rows ?? [];
      tenIds = Array.from(new Set(tenRows.map((r: any) => r.user_id)));
    }

    const ids = Array.from(new Set([...platIds, ...tenIds]));
    const profiles: Record<string, { email: string | null; full_name: string | null }> = {};
    if (ids.length > 0) {
      const { data: profs } = await context.supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", ids);
      for (const p of profs ?? []) {
        profiles[(p as any).id] = { email: (p as any).email, full_name: (p as any).full_name };
      }
    }

    const shape = (uid: string, extra: Record<string, unknown> = {}) => ({
      user_id: uid,
      email: profiles[uid]?.email ?? null,
      full_name: profiles[uid]?.full_name ?? null,
      is_you: uid === context.userId,
      ...extra,
    });

    return {
      viewer: {
        user_id: context.userId,
        is_platform_admin: viewerIsPlatformAdmin,
        is_tenant_admin: viewerIsTenantAdmin,
        can_manage_platform_secrets: viewerIsPlatformAdmin,
        can_manage_tenant_secrets: data.scope === "tenant" ? viewerIsTenantAdmin : false,
      },
      scope: data.scope,
      tenant_id: data.tenant_id ?? null,
      platform_admins: (platRows ?? []).map((r: any) => shape(r.user_id, { granted_at: r.granted_at })),
      tenant_admins: tenRows.map((r: any) => shape(r.user_id, { joined_at: r.joined_at })),
    };
  });

// ─────────────────────────────────────────────────────────────────────────────
// ROTATE WITH VERIFICATION — rotates a secret, then verifies the new key with
// the upstream provider. On verification failure, the prior encrypted envelope
// is automatically restored (auto-rollback). Plaintext is never persisted or
// returned; only fingerprint/last4 + probe status/latency are surfaced.
//
// Supported verify.kind:
//   • "llm_provider" — issues a tiny completion probe using the resolved key
//   • "none"         — skip verification (still writes version history)
// ─────────────────────────────────────────────────────────────────────────────
export const rotateVaultSecretWithVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      scope: z.enum(["platform", "tenant"]),
      tenant_id: z.string().uuid().optional(),
      secret_class: SecretClass,
      name: z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/),
      plaintext: z.string().min(1).max(24000),
      reason: z.string().max(500).optional(),
      verify: z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("llm_provider"),
          provider: z.string().min(1),
          model: z.string().min(1),
          base_url: z.string().url().nullable().optional(),
        }),
        z.object({ kind: z.literal("none") }),
      ]),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertScope(context, data.scope, data.tenant_id ?? null);

    // 1) Snapshot the current live version BEFORE rotating so we have a valid
    //    restore point. Nothing to roll back to if this is the first version.
    let selQ = context.supabase.from("app_vault_secrets")
      .select("id, version, fingerprint_sha256, last4")
      .eq("scope", data.scope).eq("secret_class", data.secret_class).eq("name", data.name);
    if (data.scope === "tenant") selQ = selQ.eq("tenant_id", data.tenant_id!);
    else selQ = selQ.is("tenant_id", null);
    const { data: prior } = await selQ.maybeSingle();
    const priorVersion: number | null = prior ? ((prior as any).version as number) : null;
    const priorFp: string | null = prior ? ((prior as any).fingerprint_sha256 as string) : null;
    const priorLast4: string | null = prior ? ((prior as any).last4 as string | null) : null;

    // 2) Rotate — reuses putVaultSecret so encryption, upsert, history snapshot
    //    and audit-logging all happen through the single canonical path.
    const putRes = await putVaultSecret({ data: {
      scope: data.scope,
      tenant_id: data.tenant_id,
      secret_class: data.secret_class,
      name: data.name,
      plaintext: data.plaintext,
      reason: data.reason,
    }}) as { id: string };
    const secretId = putRes.id;

    // Fetch new version metadata (never plaintext).
    const { data: newRow } = await context.supabase.from("app_vault_secrets")
      .select("version, fingerprint_sha256, last4")
      .eq("id", secretId).single();
    const newVersion = (newRow as any)?.version as number;
    const newFp = (newRow as any)?.fingerprint_sha256 as string;
    const newLast4 = ((newRow as any)?.last4 ?? null) as string | null;

    // 3) Verify. For llm_provider, resolve the just-stored envelope and probe
    //    the upstream. For "none", treat as verified (still keeps history).
    type Verify = { ok: boolean; kind: string; latency_ms?: number; http_status?: number | null; error?: string | null };
    let verify: Verify = { ok: true, kind: data.verify.kind };
    if (data.verify.kind === "llm_provider") {
      const v = data.verify;
      try {
        const { resolveVaultSecret } = await import("./vault-resolver.server");
        const resolved = await resolveVaultSecret(context.supabase, {
          scope: data.scope,
          tenant_id: data.tenant_id ?? null,
          secret_class: data.secret_class,
          name: data.name,
        });
        if (!resolved?.plaintext) {
          verify = { ok: false, kind: v.kind, error: "Resolver returned no plaintext for the newly stored secret" };
        } else {
          const { probeLlmKey } = await import("./llm-probe.server");
          const probe = await probeLlmKey(v.provider, v.base_url ?? null, v.model, resolved.plaintext);
          verify = {
            ok: probe.ok,
            kind: v.kind,
            latency_ms: probe.latency_ms,
            http_status: probe.http_status ?? null,
            error: probe.error ?? null,
          };
        }
      } catch (e: any) {
        verify = { ok: false, kind: v.kind, error: e?.message ?? "Verification threw" };
      }
    }

    // 4) On failure, auto-rollback to the prior version's envelope (if any).
    let rolled_back = false;
    let rollback_version: number | null = null;
    let rollback_error: string | null = null;
    if (!verify.ok) {
      if (priorVersion === null) {
        rollback_error = "No prior version exists — cannot auto-rollback the first-ever secret. Delete it manually if required.";
      } else {
        try {
          const rb = await rollbackVaultSecret({ data: {
            secret_id: secretId,
            target_version: priorVersion,
            reason: `auto-rollback: verification failed — ${(verify.error ?? "unknown error").slice(0, 300)}`,
          }}) as { new_version: number };
          rolled_back = true;
          rollback_version = rb.new_version;
        } catch (e: any) {
          rollback_error = e?.message ?? "Rollback failed";
        }
      }
    }

    // 5) Consolidated audit trail (rotate + verify + optional rollback).
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.scope === "tenant" ? data.tenant_id : null,
      scope: data.scope,
      action: verify.ok
        ? "vault.secret.rotate.verified"
        : (rolled_back ? "vault.secret.rotate.auto_rollback" : "vault.secret.rotate.verify_failed"),
      resource_type: "app_vault_secret",
      resource_id: secretId,
      context: {
        secret_class: data.secret_class,
        name: data.name,
        verify_kind: data.verify.kind,
        verify_ok: verify.ok,
        verify_latency_ms: verify.latency_ms ?? null,
        verify_http_status: verify.http_status ?? null,
        verify_error: verify.error ?? null,
        prior_version: priorVersion,
        prior_fingerprint: priorFp,
        prior_last4: priorLast4,
        attempted_version: newVersion,
        attempted_fingerprint: newFp,
        attempted_last4: newLast4,
        rolled_back,
        rollback_to_version: rolled_back ? priorVersion : null,
        rollback_new_version: rollback_version,
        rollback_error,
        reason: data.reason ?? null,
      },
    } as any);

    return {
      ok: verify.ok,
      attempted_version: newVersion,
      verify: { ok: verify.ok, kind: verify.kind, latency_ms: verify.latency_ms ?? null },
      rolled_back,
      restored_to_version: rolled_back ? priorVersion : null,
      current_version: rolled_back ? rollback_version : newVersion,
    };
  });
