import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createHash } from "node:crypto";

async function isPlatformAdmin(ctx: any) {
  const { data } = await ctx.supabase.rpc("is_platform_admin", { _user_id: ctx.userId });
  return !!data;
}
async function isTenantAdmin(ctx: any, tenantId: string) {
  const { data } = await ctx.supabase.rpc("has_tenant_role", {
    _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_admin",
  });
  return !!data;
}

const fp = (key: string) => createHash("sha256").update(key).digest("hex");

function normalizeProbeBaseUrl(input: string | null | undefined): string | undefined {
  if (!input) return undefined;
  let u = input.trim();
  if (!u) return undefined;
  u = u.replace(/\/+$/, "");
  u = u.replace(/\/(chat\/completions|completions|messages|responses|embeddings)$/i, "");
  return u.replace(/\/+$/, "");
}

function isNativeProviderHost(provider: string, baseUrl: string | undefined): boolean {
  if (!baseUrl) return true;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (provider === "anthropic") return host === "api.anthropic.com" || host.endsWith(".api.anthropic.com");
    if (provider === "muse") return host === "api.meta.ai" || host.endsWith(".api.meta.ai");
  } catch {
    return false;
  }
  return false;
}

function formatProbeError(status: number, statusText: string, contentType: string, url: string, body: string): string {
  const safeUrl = url.split("?")[0];
  const snippet = body.replace(/\s+/g, " ").slice(0, 300);
  const cause =
    status === 401 || status === 403
      ? "API key rejected by gateway/provider"
      : status === 404
        ? "base_url is not the gateway root or endpoint is not Muse-compatible"
        : "gateway returned a non-success or non-JSON response";
  return `HTTP ${status} ${statusText} from ${safeUrl}; content-type=${contentType || "none"}; ${cause}; body=${snippet || "(empty)"}`;
}

export const listLlmProviders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ scope: z.enum(["platform", "tenant"]), tenant_id: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.scope === "platform" && !(await isPlatformAdmin(context))) throw new Error("Forbidden");
    if (data.scope === "tenant" && data.tenant_id) {
      const { data: mem } = await context.supabase.rpc("is_tenant_member", {
        _user_id: context.userId, _tenant_id: data.tenant_id,
      });
      if (!mem && !(await isPlatformAdmin(context))) throw new Error("Forbidden");
    }
    let q = context.supabase
      .from("llm_providers")
      .select("id, scope, tenant_id, provider, display_name, base_url, model, key_fingerprint, key_last4, is_active, priority, created_at")
      .eq("scope", data.scope);
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    else q = q.is("tenant_id", null);
    const { data: rows, error } = await q.order("priority", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertLlmProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      scope: z.enum(["platform", "tenant"]),
      tenant_id: z.string().uuid().optional(),
      provider: z.enum([
        "anthropic", "muse", "google", "mistral", "cohere",
        "groq", "perplexity", "deepseek", "xai",
        "meta", "custom_muse_compatible",
      ]),
      display_name: z.string().min(2).max(80),
      base_url: z.string().url().optional().nullable(),
      model: z.string().min(2).max(120),
      api_key: z.string().min(8).optional(),
      is_active: z.boolean().default(true),
      priority: z.number().int().min(0).max(3).nullable().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.scope === "platform" && !(await isPlatformAdmin(context))) throw new Error("Forbidden");
    if (data.scope === "tenant") {
      if (!data.tenant_id) throw new Error("tenant_id required");
      if (!(await isTenantAdmin(context, data.tenant_id)) && !(await isPlatformAdmin(context))) throw new Error("Forbidden");
    }
    const patch: any = {
      scope: data.scope,
      tenant_id: data.scope === "tenant" ? data.tenant_id : null,
      provider: data.provider,
      display_name: data.display_name,
      base_url: data.base_url ?? null,
      model: data.model,
      is_active: data.is_active,
      priority: data.priority ?? null,
      created_by: context.userId,
    };
    if (data.api_key) {
      patch.key_fingerprint = fp(data.api_key);
      patch.key_last4 = data.api_key.slice(-4);
      // Resolver-matching name: vault lookup uses PROVIDER uppercased
      // (e.g. "ANTHROPIC", "MUSE"). Never embed the tenant UUID here —
      // the vault resolver already scopes by (scope, tenant_id).
      patch.key_secret_name = data.provider.toUpperCase();
    }

    // Capture the "before" snapshot for updates so the audit trail shows what changed.
    let before: any = null;
    if (data.id) {
      const { data: prev } = await context.supabase
        .from("llm_providers")
        .select("provider, display_name, base_url, model, is_active, priority, key_fingerprint, key_last4")
        .eq("id", data.id).maybeSingle();
      before = prev ?? null;
    }
    let row: any;
    if (data.id) {
      const { data: r, error } = await context.supabase
        .from("llm_providers").update(patch).eq("id", data.id).select("id, tenant_id").single();
      if (error) throw new Error(error.message);
      row = r;
    } else {
      const { data: r, error } = await context.supabase
        .from("llm_providers").insert(patch).select("id, tenant_id").single();
      if (error) throw new Error(error.message);
      row = r;
    }
    const keyRotated = !!data.api_key && (!before || before.key_fingerprint !== patch.key_fingerprint);
    const after = {
      provider: data.provider,
      display_name: data.display_name,
      base_url: data.base_url ?? null,
      model: data.model,
      is_active: data.is_active,
      priority: data.priority ?? null,
      key_fingerprint: patch.key_fingerprint ?? before?.key_fingerprint ?? null,
      key_last4: patch.key_last4 ?? before?.key_last4 ?? null,
    };
    // Compute a compact diff so reviewers see exactly which fields changed.
    let changed: string[] = [];
    if (before) {
      for (const k of Object.keys(after)) {
        if ((before as any)[k] !== (after as any)[k]) changed.push(k);
      }
    }
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: row.tenant_id,
      scope: data.scope,
      action: data.id ? "llm.provider.update" : "llm.provider.create",
      resource_type: "llm_provider", resource_id: row.id,
      context: {
        provider: data.provider,
        model: data.model,
        display_name: data.display_name,
        is_active: data.is_active,
        priority: data.priority ?? null,
        base_url: data.base_url ?? null,
        key_fingerprint: after.key_fingerprint, // sha256 only — never the raw key
        key_last4: after.key_last4,
        api_key_rotated: keyRotated,
        key_secret_name: patch.key_secret_name ?? null,
        before: before ?? null,
        after,
        changed_fields: data.id ? changed : Object.keys(after),
      },
    } as any);

    // Auto-vault: when an api_key is supplied we envelope-encrypt it and
    // upsert into app_vault_secrets (scope + tenant + secret_class=llm_api_key
    // + name=PROVIDER) so the resolver finds it immediately — no separate
    // manual Vault step. Plaintext never leaves this handler; only
    // fingerprint + last-4 are persisted alongside the ciphertext, matching
    // the audit posture of putVaultSecret.
    let vault_status: "created" | "rotated" | "unchanged" | "error" | "none" = "none";
    let vault_error: string | null = null;
    if (data.api_key) {
      try {
        const { encryptSecret, bytesToPgHex, getAdapter } = await import("./vault.server");
        // Pick default KMS binding for this scope (fallback to meta_managed).
        let vprovider: "meta_managed" | "aws_kms" | "gcp_kms" | "azure_kv" = "meta_managed";
        let vkeyRef = "APP_DATA_ENC_KEY";
        let bq = context.supabase
          .from("app_vault_kms_bindings")
          .select("provider, key_ref").eq("scope", data.scope)
          .eq("is_default", true).eq("status", "active");
        bq = data.scope === "tenant" ? bq.eq("tenant_id", data.tenant_id!) : bq.is("tenant_id", null);
        const { data: bind } = await bq.maybeSingle();
        if (bind) { vprovider = (bind as any).provider; vkeyRef = (bind as any).key_ref; }
        const adapter = getAdapter(vprovider, vkeyRef);
        const enc = await encryptSecret(data.api_key, adapter);
        const vname = data.provider.toUpperCase();

        let selQ = context.supabase.from("app_vault_secrets")
          .select("id, version, fingerprint_sha256")
          .eq("scope", data.scope).eq("secret_class", "llm_api_key").eq("name", vname);
        selQ = data.scope === "tenant" ? selQ.eq("tenant_id", data.tenant_id!) : selQ.is("tenant_id", null);
        const { data: existingVault } = await selQ.maybeSingle();

        const vrow: any = {
          scope: data.scope,
          tenant_id: data.scope === "tenant" ? data.tenant_id : null,
          secret_class: "llm_api_key",
          name: vname,
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

        let secretId: string; let newVersion: number;
        if (existingVault) {
          const prevFp = (existingVault as any).fingerprint_sha256;
          if (prevFp === enc.fingerprint_sha256) {
            vault_status = "unchanged";
            secretId = (existingVault as any).id; newVersion = (existingVault as any).version ?? 1;
          } else {
            vrow.version = ((existingVault as any).version ?? 1) + 1;
            vrow.rotated_at = new Date().toISOString();
            const { data: vr, error: verr } = await context.supabase
              .from("app_vault_secrets").update(vrow).eq("id", (existingVault as any).id).select("id, version").single();
            if (verr) throw new Error(verr.message);
            secretId = vr!.id; newVersion = vr!.version; vault_status = "rotated";
            await context.supabase.from("app_vault_rotation_log").insert({
              secret_id: secretId, rotated_by: context.userId,
              from_version: (existingVault as any).version ?? 1, to_version: newVersion,
              from_fingerprint: prevFp, to_fingerprint: enc.fingerprint_sha256,
              kek_provider: enc.kek_provider, kek_ref: enc.kek_ref,
              reason: "auto: llm_provider upsert",
            } as any);
          }
        } else {
          const { data: vr, error: verr } = await context.supabase
            .from("app_vault_secrets").insert(vrow).select("id, version").single();
          if (verr) throw new Error(verr.message);
          secretId = vr!.id; newVersion = vr!.version; vault_status = "created";
        }

        // Snapshot to version history — mirrors putVaultSecret behaviour.
        if (vault_status !== "unchanged") {
          await context.supabase.from("app_vault_secret_versions").insert({
            secret_id: secretId, version: newVersion,
            scope: vrow.scope, tenant_id: vrow.tenant_id,
            secret_class: vrow.secret_class, name: vrow.name,
            ciphertext: vrow.ciphertext, iv: vrow.iv, auth_tag: vrow.auth_tag,
            wrapped_dek: vrow.wrapped_dek, kek_provider: vrow.kek_provider, kek_ref: vrow.kek_ref,
            fingerprint_sha256: vrow.fingerprint_sha256, last4: vrow.last4,
            reason: "auto: llm_provider upsert",
            change_kind: vault_status === "rotated" ? "rotate" : "create",
            created_by: context.userId,
          } as any);
          await context.supabase.from("audit_log").insert({
            actor_user_id: context.userId,
            tenant_id: data.scope === "tenant" ? data.tenant_id : null,
            scope: data.scope,
            action: vault_status === "rotated" ? "vault.secret.rotate" : "vault.secret.create",
            resource_type: "app_vault_secret", resource_id: secretId,
            context: {
              secret_class: "llm_api_key", name: vname,
              source: "llm_provider_autosync", provider: data.provider,
              kek_provider: enc.kek_provider, kek_ref: enc.kek_ref,
              fingerprint_sha256: enc.fingerprint_sha256, last4: enc.last4,
            },
          } as any);
        }
      } catch (e: any) {
        vault_status = "error";
        vault_error = e?.message ?? String(e);
      }
    }
    return { id: row.id, vault_status, vault_error };
  });


export const deleteLlmProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: cur } = await context.supabase
      .from("llm_providers")
      .select("scope, tenant_id, provider, display_name, model, base_url, is_active, priority, key_fingerprint, key_last4, key_secret_name")
      .eq("id", data.id).single();
    if (!cur) throw new Error("Not found");
    const c: any = cur;
    if (c.scope === "platform" && !(await isPlatformAdmin(context))) throw new Error("Forbidden");
    if (c.scope === "tenant" && !(await isTenantAdmin(context, c.tenant_id)) && !(await isPlatformAdmin(context)))
      throw new Error("Forbidden");
    const { error } = await context.supabase.from("llm_providers").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: c.tenant_id,
      scope: c.scope,
      action: "llm.provider.delete",
      resource_type: "llm_provider", resource_id: data.id,
      context: {
        provider: c.provider,
        display_name: c.display_name,
        model: c.model,
        base_url: c.base_url,
        is_active: c.is_active,
        priority: c.priority,
        key_fingerprint: c.key_fingerprint, // sha256 only
        key_last4: c.key_last4,
        key_secret_name: c.key_secret_name,
      },
    } as any);
    return { ok: true };
  });

// ============================================================================
// Meta AI Gateway ultimate-fallback toggle
// ============================================================================
export const getLlmFallbackSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ scope: z.enum(["platform", "tenant"]), tenant_id: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.scope === "platform") {
      if (!(await isPlatformAdmin(context))) throw new Error("Forbidden");
      const { data: row } = await context.supabase
        .from("platform_ai_settings").select("meta_gateway_fallback_enabled").eq("id", true).maybeSingle();
      return { meta_gateway_fallback_enabled: (row as any)?.meta_gateway_fallback_enabled ?? true };
    }
    if (!data.tenant_id) throw new Error("tenant_id required");
    const { data: mem } = await context.supabase.rpc("is_tenant_member", { _user_id: context.userId, _tenant_id: data.tenant_id });
    if (!mem && !(await isPlatformAdmin(context))) throw new Error("Forbidden");
    const { data: t } = await context.supabase
      .from("tenant_ai_settings").select("meta_gateway_fallback_enabled").eq("tenant_id", data.tenant_id).maybeSingle();
    const { data: p } = await context.supabase
      .from("platform_ai_settings").select("meta_gateway_fallback_enabled").eq("id", true).maybeSingle();
    const tenantValue = (t as any)?.meta_gateway_fallback_enabled;
    return {
      meta_gateway_fallback_enabled: tenantValue ?? (p as any)?.meta_gateway_fallback_enabled ?? true,
      inherits_platform: tenantValue === null || tenantValue === undefined,
      platform_default: (p as any)?.meta_gateway_fallback_enabled ?? true,
    };
  });

export const setLlmFallbackSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      scope: z.enum(["platform", "tenant"]),
      tenant_id: z.string().uuid().optional(),
      enabled: z.boolean().nullable(), // null = inherit (tenant only)
    }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.scope === "platform") {
      if (!(await isPlatformAdmin(context))) throw new Error("Forbidden");
      const { error } = await context.supabase
        .from("platform_ai_settings")
        .update({ meta_gateway_fallback_enabled: !!data.enabled, updated_by: context.userId })
        .eq("id", true);
      if (error) throw new Error(error.message);
      await context.supabase.from("audit_log").insert({
        actor_user_id: context.userId, tenant_id: null, scope: "platform",
        action: "llm.gateway_fallback.update", resource_type: "platform_ai_settings",
        context: { enabled: !!data.enabled },
      } as any);
      return { ok: true };
    }
    if (!data.tenant_id) throw new Error("tenant_id required");
    if (!(await isTenantAdmin(context, data.tenant_id)) && !(await isPlatformAdmin(context))) throw new Error("Forbidden");
    const { error } = await context.supabase
      .from("tenant_ai_settings")
      .upsert({ tenant_id: data.tenant_id, meta_gateway_fallback_enabled: data.enabled }, { onConflict: "tenant_id" });
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "llm.gateway_fallback.update", resource_type: "tenant_ai_settings",
      context: { enabled: data.enabled },
    } as any);
    return { ok: true };
  });

// ============================================================================
// Provider probe — reads secret env var by name, does a tiny completion,
// returns { ok, latency_ms, error?, http_status? }. Key is never returned.
// ============================================================================
type ProbeResult = { ok: boolean; latency_ms: number; http_status?: number; error?: string; sample?: string };

async function probeProvider(provider: string, base_url: string | null, model: string, api_key: string): Promise<ProbeResult> {
  const started = Date.now();
  try {
    let url = ""; let headers: Record<string, string> = { "content-type": "application/json" }; let body: any;
    const museCompat = (b: string) => {
      url = (normalizeProbeBaseUrl(b) ?? b.replace(/\/$/, "")) + "/chat/completions";
      headers.authorization = `Bearer ${api_key}`;
      body = { model, max_tokens: 8, messages: [{ role: "user", content: "ping" }] };
    };
    const normalizedBase = normalizeProbeBaseUrl(base_url);
    switch (provider) {
      case "anthropic":
        if (isNativeProviderHost(provider, normalizedBase)) {
          url = (normalizedBase ?? "https://api.anthropic.com") + "/v1/messages";
          headers["x-api-key"] = api_key;
          headers["anthropic-version"] = "2023-06-01";
          body = { model, max_tokens: 8, messages: [{ role: "user", content: "ping" }] };
        } else {
          museCompat(normalizedBase!);
        }
        break;
      case "muse":     museCompat(normalizedBase || "https://api.meta.ai/v1"); break;
      case "groq":       museCompat(normalizedBase || "https://api.groq.com/muse/v1"); break;
      case "perplexity": museCompat(normalizedBase || "https://api.perplexity.ai"); break;
      case "deepseek":   museCompat(normalizedBase || "https://api.deepseek.com/v1"); break;
      case "xai":        museCompat(normalizedBase || "https://api.x.ai/v1"); break;
      case "mistral":    museCompat(normalizedBase || "https://api.mistral.ai/v1"); break;
      case "cohere":
        url = (normalizedBase ?? "https://api.cohere.ai") + "/v1/chat";
        headers.authorization = `Bearer ${api_key}`;
        body = { model, message: "ping", max_tokens: 8 };
        break;
      case "google":
        url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(api_key)}`;
        body = { contents: [{ role: "user", parts: [{ text: "ping" }] }], generationConfig: { maxOutputTokens: 8 } };
        break;
      case "meta":
        url = "https://api.meta.ai/v1/chat/completions";
        headers["Meta-API-Key"] = api_key;
        body = { model, max_tokens: 8, messages: [{ role: "user", content: "ping" }] };
        break;
      case "custom_muse_compatible":
        if (!base_url) return { ok: false, latency_ms: 0, error: "Base URL required for custom provider" };
        museCompat(normalizedBase!);
        break;
      default: return { ok: false, latency_ms: 0, error: `Unknown provider ${provider}` };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    clearTimeout(timer);
    const latency = Date.now() - started;
    const contentType = r.headers.get("content-type") || "";
    const responseText = await r.text().catch(() => "");
    if (!r.ok) {
      return { ok: false, latency_ms: latency, http_status: r.status, error: formatProbeError(r.status, r.statusText, contentType, url, responseText) };
    }
    if (!contentType.includes("application/json") && !contentType.includes("+json")) {
      return { ok: false, latency_ms: latency, http_status: r.status, error: formatProbeError(r.status, r.statusText, contentType, url, responseText) };
    }
    try {
      JSON.parse(responseText);
    } catch {
      return { ok: false, latency_ms: latency, http_status: r.status, error: formatProbeError(r.status, r.statusText, contentType, url, responseText) };
    }
    return { ok: true, latency_ms: latency, http_status: r.status };
  } catch (e: any) {
    return { ok: false, latency_ms: Date.now() - started, error: e?.name === "AbortError" ? "Timed out after 15s" : (e?.message ?? "Network error") };
  }
}

// Server-side rate limit — refuses abuse of "Test provider" / "Test chain"
// so a rogue admin cannot run up LLM bills. Enforces two caps in one call:
//   • per-user (configurable)
//   • per-tenant global shared (configurable; platform-wide when scope=platform)
// Both caps are read from platform_ai_settings with optional tenant_ai_settings overrides.
async function resolveRateLimits(ctx: any, scope: "platform" | "tenant", tenantId: string | null) {
  const { data: p } = await ctx.supabase
    .from("platform_ai_settings")
    .select("llm_rl_per_user_max, llm_rl_per_user_window_seconds, llm_rl_per_tenant_max, llm_rl_per_tenant_window_seconds")
    .eq("id", true).maybeSingle();
  const platform = {
    per_user_max: (p as any)?.llm_rl_per_user_max ?? 20,
    per_user_window_seconds: (p as any)?.llm_rl_per_user_window_seconds ?? 60,
    per_tenant_max: (p as any)?.llm_rl_per_tenant_max ?? 200,
    per_tenant_window_seconds: (p as any)?.llm_rl_per_tenant_window_seconds ?? 60,
  };
  if (scope === "tenant" && tenantId) {
    const { data: t } = await ctx.supabase
      .from("tenant_ai_settings")
      .select("llm_rl_per_user_max, llm_rl_per_user_window_seconds, llm_rl_per_tenant_max, llm_rl_per_tenant_window_seconds")
      .eq("tenant_id", tenantId).maybeSingle();
    return {
      per_user_max: (t as any)?.llm_rl_per_user_max ?? platform.per_user_max,
      per_user_window_seconds: (t as any)?.llm_rl_per_user_window_seconds ?? platform.per_user_window_seconds,
      per_tenant_max: (t as any)?.llm_rl_per_tenant_max ?? platform.per_tenant_max,
      per_tenant_window_seconds: (t as any)?.llm_rl_per_tenant_window_seconds ?? platform.per_tenant_window_seconds,
    };
  }
  return platform;
}

async function enforceTestRateLimit(ctx: any, scope: "platform" | "tenant", tenantId: string | null = null) {
  const cfg = await resolveRateLimits(ctx, scope, tenantId);
  const { data: res, error } = await ctx.supabase.rpc("try_llm_rate_limit_pair", {
    _user_id: ctx.userId,
    _tenant_id: tenantId,
    _scope: scope,
    _user_max: cfg.per_user_max,
    _user_window_seconds: cfg.per_user_window_seconds,
    _tenant_max: cfg.per_tenant_max,
    _tenant_window_seconds: cfg.per_tenant_window_seconds,
  });
  if (error) throw new Error(`Rate-limit check failed: ${error.message}`);
  const r: any = res;
  if (!r?.ok) {
    if (r?.exceeded === "user") {
      throw new Error(`Rate limit reached — max ${r.user_max} LLM test calls per ${r.user_window_seconds}s per user. Try again shortly.`);
    }
    if (r?.exceeded === "tenant") {
      const label = scope === "tenant" ? "tenant" : "platform";
      throw new Error(`Rate limit reached — max ${r.tenant_max} LLM test calls per ${r.tenant_window_seconds}s for this ${label} (shared across all users).`);
    }
    throw new Error("Rate limit reached. Try again shortly.");
  }
}

export const testLlmProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<ProbeResult & { secret_name?: string; provider?: string }> => {
    const { data: row } = await context.supabase
      .from("llm_providers")
      .select("id, scope, tenant_id, provider, base_url, model, key_secret_name")
      .eq("id", data.id).single();
    if (!row) return { ok: false, latency_ms: 0, error: "Provider not found" };
    const r: any = row;
    if (r.scope === "platform" && !(await isPlatformAdmin(context))) throw new Error("Forbidden");
    if (r.scope === "tenant" && !(await isTenantAdmin(context, r.tenant_id)) && !(await isPlatformAdmin(context))) throw new Error("Forbidden");
    await enforceTestRateLimit(context, r.scope as any, r.tenant_id ?? null);
    const secretName: string | null = r.key_secret_name ?? null;
    const { resolveVaultSecret } = await import("./vault-resolver.server");
    const resolved = await resolveVaultSecret(context.supabase, {
      scope: r.scope, tenant_id: r.tenant_id ?? null,
      secret_class: "llm_api_key", name: r.provider.toUpperCase(),
    });
    const key = resolved?.plaintext;
    if (!key) return { ok: false, latency_ms: 0, error: `No API key in vault for ${r.provider}. Add it under ${r.scope === "platform" ? "Platform" : "Tenant"} → Vault (class: llm_api_key, name: ${r.provider.toUpperCase()}).`, secret_name: secretName ?? undefined, provider: r.provider };
    const probe = await probeProvider(r.provider, r.base_url ?? null, r.model, key);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: r.tenant_id, scope: r.scope,
      action: "llm.provider.test", resource_type: "llm_provider", resource_id: r.id,
      context: { ok: probe.ok, latency_ms: probe.latency_ms, http_status: probe.http_status ?? null, error: probe.error ?? null },
    } as any);
    return { ...probe, secret_name: secretName ?? undefined, provider: r.provider };
  });

// ============================================================================
// preflightLlmChain — verifies the required LLM vault secrets exist for every
// active tier BEFORE any chain test is attempted. Read-only: no upstream
// provider calls, no decryption of plaintext key material — only checks the
// vault row's presence (scope + secret_class=llm_api_key + name=PROVIDER).
// Returns { ready, tiers[], missing[] } so the UI can block "Test chain"
// with an actionable message instead of firing a doomed request.
// ============================================================================
export const preflightLlmChain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ scope: z.enum(["platform", "tenant"]), tenant_id: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.scope === "platform" && !(await isPlatformAdmin(context))) throw new Error("Forbidden");
    if (data.scope === "tenant") {
      if (!data.tenant_id) throw new Error("tenant_id required");
      if (!(await isTenantAdmin(context, data.tenant_id)) && !(await isPlatformAdmin(context))) throw new Error("Forbidden");
    }
    let q = context.supabase.from("llm_providers")
      .select("id, provider, model, priority, is_active, key_secret_name")
      .eq("scope", data.scope).not("priority", "is", null).eq("is_active", true);
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id); else q = q.is("tenant_id", null);
    const { data: rows, error } = await q.order("priority", { ascending: true });
    if (error) throw new Error(error.message);
    const providers = (rows ?? []) as Array<any>;

    if (providers.length === 0) {
      return { ready: false, reason: "no_active_tiers", tiers: [], missing: [], invalid_bindings: [] };
    }

    // Cloud-Secret / env-var naming rule (Meta Cloud + POSIX):
    //   starts with a letter or underscore, then letters/digits/underscores,
    //   max 256 chars. Anything else (hyphens, lowercase, dots, spaces) is a
    //   binding that will fail to resolve at runtime.
    const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,255}$/;

    // Query vault presence in a single round-trip. `meta` provider uses the
    // built-in gateway and does not require a customer-managed vault secret.
    const wanted = providers
      .filter((p) => p.provider !== "meta")
      .map((p) => (p.provider as string).toUpperCase());
    const vaultMap = new Map<string, boolean>();
    if (wanted.length > 0) {
      let vq = context.supabase.from("app_vault_secrets")
        .select("name")
        .eq("scope", data.scope)
        .eq("secret_class", "llm_api_key")
        .in("name", wanted);
      if (data.tenant_id) vq = vq.eq("tenant_id", data.tenant_id); else vq = vq.is("tenant_id", null);
      const { data: vrows } = await vq;
      for (const v of (vrows ?? []) as any[]) vaultMap.set(String(v.name).toUpperCase(), true);
    }

    const tiers = providers.map((p) => {
      const providerKey = String(p.provider).toUpperCase();
      const managed = p.provider === "meta";
      const secretPresent = managed ? true : vaultMap.has(providerKey);
      const binding: string | null = (p.key_secret_name ?? null) as string | null;
      // Binding is "invalid" when:
      //  - it's set but violates env-var naming (hyphen/lowercase/dot/space), OR
      //  - it's set and disagrees with the expected `PROVIDER` name the resolver looks up.
      let binding_valid = true;
      let binding_issue: string | null = null;
      if (!managed && binding) {
        if (!ENV_NAME_RE.test(binding)) {
          binding_valid = false;
          binding_issue = `Invalid env-var name "${binding}". Use only A-Z, 0-9, underscore; must start with a letter/underscore.`;
        } else if (binding.toUpperCase() !== providerKey) {
          binding_valid = false;
          binding_issue = `Binding "${binding}" does not match resolver lookup "${providerKey}". Rename to "${providerKey}".`;
        }
      }
      return {
        priority: p.priority,
        provider: p.provider,
        model: p.model,
        secret_name: managed ? null : providerKey,
        binding_name: binding,
        binding_valid,
        binding_issue,
        secret_present: secretPresent,
        managed,
      };
    });
    const missing = tiers.filter((t) => !t.secret_present);
    const invalid_bindings = tiers.filter((t) => !t.binding_valid);
    const ready = missing.length === 0 && invalid_bindings.length === 0;
    return {
      ready,
      reason: ready ? "ok" : (missing.length > 0 ? "missing_secrets" : "invalid_binding"),
      scope: data.scope,
      tenant_id: data.tenant_id ?? null,
      tiers,
      missing,
      invalid_bindings,
    };
  });


export const testLlmChain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ scope: z.enum(["platform", "tenant"]), tenant_id: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.scope === "platform" && !(await isPlatformAdmin(context))) throw new Error("Forbidden");
    if (data.scope === "tenant") {
      if (!data.tenant_id) throw new Error("tenant_id required");
      if (!(await isTenantAdmin(context, data.tenant_id)) && !(await isPlatformAdmin(context))) throw new Error("Forbidden");
    }
    await enforceTestRateLimit(context, data.scope, data.tenant_id ?? null);
    let q = context.supabase.from("llm_providers")
      .select("id, provider, model, base_url, key_secret_name, priority, is_active")
      .eq("scope", data.scope).not("priority", "is", null).eq("is_active", true);
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id); else q = q.is("tenant_id", null);
    const { data: rows } = await q.order("priority", { ascending: true });
    // Preflight — same check the UI runs, but enforced server-side so external
    // callers (SDK, curl) can't burn the rate-limit bucket on a doomed chain.
    {
      const wanted = ((rows ?? []) as any[])
        .filter((r) => r.provider !== "meta")
        .map((r) => String(r.provider).toUpperCase());
      if (wanted.length > 0) {
        let vq = context.supabase.from("app_vault_secrets")
          .select("name").eq("scope", data.scope).eq("secret_class", "llm_api_key").in("name", wanted);
        if (data.tenant_id) vq = vq.eq("tenant_id", data.tenant_id); else vq = vq.is("tenant_id", null);
        const { data: vrows } = await vq;
        const present = new Set((vrows ?? []).map((v: any) => String(v.name).toUpperCase()));
        const missing = wanted.filter((n) => !present.has(n));
        if (missing.length > 0) {
          throw new Error(`Preflight failed — missing vault secrets: ${missing.join(", ")}. Add them under Vault (class: llm_api_key).`);
        }
      }
    }
    const results: any[] = [];
    let firstOk: any = null;
    const { resolveVaultSecret } = await import("./vault-resolver.server");
    for (const r of (rows ?? []) as any[]) {
      const resolved = await resolveVaultSecret(context.supabase, {
        scope: data.scope, tenant_id: data.tenant_id ?? null,
        secret_class: "llm_api_key", name: r.provider.toUpperCase(),
      });
      const key = resolved?.plaintext;
      const probe = key
        ? await probeProvider(r.provider, r.base_url ?? null, r.model, key)
        : { ok: false, latency_ms: 0, error: `No key in vault (llm_api_key/${r.provider.toUpperCase()}). Add it under Vault.` };
      const isChosen = probe.ok && !firstOk;
      // In a real fallback, tiers *after* the first OK are never called — mark them "skipped_in_prod"
      // even though we probed them here so the admin can see their health.
      results.push({
        priority: r.priority, provider: r.provider, model: r.model, id: r.id,
        role: isChosen ? "chosen" : probe.ok ? "backup_ok" : firstOk ? "skipped_in_prod" : "attempted_failed",
        ...probe,
      });
      if (isChosen) firstOk = { priority: r.priority, provider: r.provider, model: r.model, latency_ms: probe.latency_ms };
    }
    // Persist per-tier probes into llm_failover_test_runs so the health
    // report can trend latency and failure rates over time. Tenant-scope only —
    // the failover_test_runs table has a NOT NULL tenant_id via FK semantics.
    if (data.scope === "tenant" && data.tenant_id) {
      const scenarioFor = (priority: number): string =>
        priority === 1 ? "primary" : priority === 2 ? "fallback1" : priority === 3 ? "fallback2" : "health";
      const rowsToInsert = results.map((r) => ({
        tenant_id: data.tenant_id!,
        route_id: null,
        scenario: scenarioFor(r.priority),
        provider_used: r.id ?? null,
        model_used: r.model ?? null,
        status: r.ok ? "pass" : "fail",
        latency_ms: r.latency_ms ?? null,
        tokens_in: 0, tokens_out: 0, cost_usd: 0,
        error_message: r.ok ? null : (r.error ?? null),
        context: { role: r.role, provider: r.provider, source: "chain_test" },
        tested_by: context.userId,
      }));
      if (rowsToInsert.length > 0) {
        await context.supabase.from("llm_failover_test_runs").insert(rowsToInsert as any);
      }
    }
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id ?? null, scope: data.scope,
      action: "llm.chain.test", resource_type: "llm_chain",
      context: { ran: results.length, first_ok: firstOk, results: results.map((r) => ({ priority: r.priority, provider: r.provider, ok: r.ok, latency_ms: r.latency_ms, role: r.role })) },
    } as any);
    return { ran: results.length, first_ok: firstOk, results };
  });

// ============================================================================
// Per-tenant LLM chain health report — trends latency + failure rate from
// llm_failover_test_runs over a window (default 30d), bucketed by day.
// Returns:
//   - overall: totals, pass_rate, p50/p95/avg latency, chosen_rate
//   - by_provider: same metrics per provider+model+scenario
//   - by_day: daily buckets for charting (totals, pass_rate, avg_latency_ms)
// ============================================================================
export const getLlmChainHealthReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      window_days: z.number().int().min(1).max(180).default(30),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: mem } = await context.supabase.rpc("is_tenant_member", {
      _user_id: context.userId, _tenant_id: data.tenant_id,
    });
    if (!mem && !(await isPlatformAdmin(context))) throw new Error("Forbidden");

    const since = new Date(Date.now() - data.window_days * 86_400_000).toISOString();
    const { data: rowsRaw, error } = await context.supabase
      .from("llm_failover_test_runs")
      .select("id, scenario, provider_used, model_used, status, latency_ms, error_message, context, created_at")
      .eq("tenant_id", data.tenant_id)
      .gte("created_at", since)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const rows = (rowsRaw ?? []) as Array<any>;

    // Resolve provider names in one round-trip.
    const providerIds = Array.from(new Set(rows.map((r) => r.provider_used).filter(Boolean)));
    const providerMap = new Map<string, { provider: string; model: string | null }>();
    if (providerIds.length > 0) {
      const { data: provs } = await context.supabase
        .from("llm_providers").select("id, provider, model").in("id", providerIds as string[]);
      for (const p of (provs ?? []) as any[]) providerMap.set(p.id, { provider: p.provider, model: p.model });
    }

    const pct = (arr: number[], p: number): number | null => {
      if (arr.length === 0) return null;
      const s = [...arr].sort((a, b) => a - b);
      const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
      return s[idx];
    };
    const stat = (lats: number[], pass: number, total: number) => ({
      total, pass, fail: total - pass,
      pass_rate: total === 0 ? null : +(pass / total * 100).toFixed(2),
      avg_latency_ms: lats.length === 0 ? null : Math.round(lats.reduce((a, b) => a + b, 0) / lats.length),
      p50_latency_ms: pct(lats, 50),
      p95_latency_ms: pct(lats, 95),
    });

    // Overall + chosen_rate (rows where context.role='chosen').
    const overallLats: number[] = []; let overallPass = 0; let chosen = 0;
    // By provider|model|scenario.
    type Bucket = { key: string; provider: string; model: string | null; scenario: string; lats: number[]; pass: number; total: number };
    const byKey = new Map<string, Bucket>();
    // By day.
    type Day = { day: string; lats: number[]; pass: number; total: number };
    const byDay = new Map<string, Day>();

    for (const r of rows) {
      const lat = typeof r.latency_ms === "number" ? r.latency_ms : null;
      if (lat !== null) overallLats.push(lat);
      if (r.status === "pass") overallPass += 1;
      if ((r.context as any)?.role === "chosen") chosen += 1;

      const pinfo = r.provider_used ? providerMap.get(r.provider_used) : null;
      const providerName = pinfo?.provider ?? (r.context as any)?.provider ?? "unknown";
      const modelName = pinfo?.model ?? r.model_used ?? null;
      const key = `${providerName}|${modelName ?? "-"}|${r.scenario}`;
      const b: Bucket = byKey.get(key) ?? { key, provider: providerName, model: modelName, scenario: r.scenario, lats: [], pass: 0, total: 0 };
      if (lat !== null) b.lats.push(lat);
      if (r.status === "pass") b.pass += 1;
      b.total += 1;
      byKey.set(key, b);

      const day = String(r.created_at).slice(0, 10);
      const d: Day = byDay.get(day) ?? { day, lats: [], pass: 0, total: 0 };
      if (lat !== null) d.lats.push(lat);
      if (r.status === "pass") d.pass += 1;
      d.total += 1;
      byDay.set(day, d);
    }

    // Recent failures for a quick "what went wrong" panel (max 20).
    const recent_failures = rows
      .filter((r) => r.status !== "pass")
      .slice(-20).reverse()
      .map((r) => {
        const pinfo = r.provider_used ? providerMap.get(r.provider_used) : null;
        return {
          id: r.id, created_at: r.created_at, scenario: r.scenario,
          provider: pinfo?.provider ?? (r.context as any)?.provider ?? "unknown",
          model: pinfo?.model ?? r.model_used ?? null,
          latency_ms: r.latency_ms, error: r.error_message,
        };
      });

    return {
      window_days: data.window_days,
      since,
      overall: {
        ...stat(overallLats, overallPass, rows.length),
        chosen_count: chosen,
        chosen_rate: rows.length === 0 ? null : +(chosen / rows.length * 100).toFixed(2),
      },
      by_provider: Array.from(byKey.values())
        .map((b) => ({ provider: b.provider, model: b.model, scenario: b.scenario, ...stat(b.lats, b.pass, b.total) }))
        .sort((a, b) => (b.total - a.total)),
      by_day: Array.from(byDay.values())
        .map((d) => ({ day: d.day, ...stat(d.lats, d.pass, d.total) }))
        .sort((a, b) => a.day.localeCompare(b.day)),
      recent_failures,
    };
  });

// ============================================================================
// Master "AI enabled" kill-switch (platform + tenant)
// ============================================================================
export const getAiEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ scope: z.enum(["platform", "tenant"]), tenant_id: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.scope === "platform") {
      if (!(await isPlatformAdmin(context))) throw new Error("Forbidden");
      const { data: p } = await context.supabase
        .from("platform_ai_settings").select("ai_enabled").eq("id", true).maybeSingle();
      return { ai_enabled: (p as any)?.ai_enabled ?? true };
    }
    if (!data.tenant_id) throw new Error("tenant_id required");
    const { data: mem } = await context.supabase.rpc("is_tenant_member", { _user_id: context.userId, _tenant_id: data.tenant_id });
    if (!mem && !(await isPlatformAdmin(context))) throw new Error("Forbidden");
    const { data: t } = await context.supabase
      .from("tenant_ai_settings").select("ai_enabled").eq("tenant_id", data.tenant_id).maybeSingle();
    const { data: p } = await context.supabase
      .from("platform_ai_settings").select("ai_enabled").eq("id", true).maybeSingle();
    return {
      ai_enabled: ((t as any)?.ai_enabled ?? true) && ((p as any)?.ai_enabled ?? true),
      tenant_ai_enabled: (t as any)?.ai_enabled ?? true,
      platform_ai_enabled: (p as any)?.ai_enabled ?? true,
    };
  });

export const setAiEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ scope: z.enum(["platform", "tenant"]), tenant_id: z.string().uuid().optional(), enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.scope === "platform") {
      if (!(await isPlatformAdmin(context))) throw new Error("Forbidden");
      const { error } = await context.supabase
        .from("platform_ai_settings").update({ ai_enabled: data.enabled, updated_by: context.userId }).eq("id", true);
      if (error) throw new Error(error.message);
      await context.supabase.from("audit_log").insert({
        actor_user_id: context.userId, tenant_id: null, scope: "platform",
        action: "llm.ai_enabled.update", resource_type: "platform_ai_settings",
        context: { enabled: data.enabled },
      } as any);
      return { ok: true };
    }
    if (!data.tenant_id) throw new Error("tenant_id required");
    if (!(await isTenantAdmin(context, data.tenant_id)) && !(await isPlatformAdmin(context))) throw new Error("Forbidden");
    const { error } = await context.supabase
      .from("tenant_ai_settings")
      .upsert({ tenant_id: data.tenant_id, ai_enabled: data.enabled }, { onConflict: "tenant_id" });
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "llm.ai_enabled.update", resource_type: "tenant_ai_settings",
      context: { enabled: data.enabled },
    } as any);
    return { ok: true };
  });

// ============================================================================
// Configurable LLM rate limits (per-user and per-tenant/global shared)
// ============================================================================
const RL_COLS =
  "llm_rl_per_user_max, llm_rl_per_user_window_seconds, llm_rl_per_tenant_max, llm_rl_per_tenant_window_seconds";

const rlBoundsSchema = z.object({
  per_user_max: z.number().int().min(1).max(100_000).nullable().optional(),
  per_user_window_seconds: z.number().int().min(1).max(86_400).nullable().optional(),
  per_tenant_max: z.number().int().min(1).max(1_000_000).nullable().optional(),
  per_tenant_window_seconds: z.number().int().min(1).max(86_400).nullable().optional(),
});

export const getLlmRateLimits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ scope: z.enum(["platform", "tenant"]), tenant_id: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.scope === "platform" && !(await isPlatformAdmin(context))) throw new Error("Forbidden");
    if (data.scope === "tenant") {
      if (!data.tenant_id) throw new Error("tenant_id required");
      const { data: mem } = await context.supabase.rpc("is_tenant_member", {
        _user_id: context.userId, _tenant_id: data.tenant_id,
      });
      if (!mem && !(await isPlatformAdmin(context))) throw new Error("Forbidden");
    }
    const { data: p } = await context.supabase
      .from("platform_ai_settings").select(RL_COLS).eq("id", true).maybeSingle();
    const platform = {
      per_user_max: (p as any)?.llm_rl_per_user_max ?? 20,
      per_user_window_seconds: (p as any)?.llm_rl_per_user_window_seconds ?? 60,
      per_tenant_max: (p as any)?.llm_rl_per_tenant_max ?? 200,
      per_tenant_window_seconds: (p as any)?.llm_rl_per_tenant_window_seconds ?? 60,
    };
    if (data.scope === "platform") {
      return { scope: "platform" as const, platform_default: platform, effective: platform, tenant_override: null };
    }
    const { data: t } = await context.supabase
      .from("tenant_ai_settings").select(RL_COLS).eq("tenant_id", data.tenant_id!).maybeSingle();
    const override = {
      per_user_max: (t as any)?.llm_rl_per_user_max ?? null,
      per_user_window_seconds: (t as any)?.llm_rl_per_user_window_seconds ?? null,
      per_tenant_max: (t as any)?.llm_rl_per_tenant_max ?? null,
      per_tenant_window_seconds: (t as any)?.llm_rl_per_tenant_window_seconds ?? null,
    };
    const effective = {
      per_user_max: override.per_user_max ?? platform.per_user_max,
      per_user_window_seconds: override.per_user_window_seconds ?? platform.per_user_window_seconds,
      per_tenant_max: override.per_tenant_max ?? platform.per_tenant_max,
      per_tenant_window_seconds: override.per_tenant_window_seconds ?? platform.per_tenant_window_seconds,
    };
    return { scope: "tenant" as const, platform_default: platform, tenant_override: override, effective };
  });

export const setLlmRateLimits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      scope: z.enum(["platform", "tenant"]),
      tenant_id: z.string().uuid().optional(),
      limits: rlBoundsSchema,
    }).parse(d))
  .handler(async ({ data, context }) => {
    const patch: Record<string, number | null> = {};
    const lim = data.limits;
    if (lim.per_user_max !== undefined) patch.llm_rl_per_user_max = lim.per_user_max;
    if (lim.per_user_window_seconds !== undefined) patch.llm_rl_per_user_window_seconds = lim.per_user_window_seconds;
    if (lim.per_tenant_max !== undefined) patch.llm_rl_per_tenant_max = lim.per_tenant_max;
    if (lim.per_tenant_window_seconds !== undefined) patch.llm_rl_per_tenant_window_seconds = lim.per_tenant_window_seconds;

    if (data.scope === "platform") {
      if (!(await isPlatformAdmin(context))) throw new Error("Forbidden");
      // Platform defaults cannot be NULL — reject and require a concrete number.
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) throw new Error(`Platform default for ${k} cannot be null. Provide a number.`);
      }
      const { error } = await context.supabase
        .from("platform_ai_settings").update({ ...patch, updated_by: context.userId }).eq("id", true);
      if (error) throw new Error(error.message);
      await context.supabase.from("audit_log").insert({
        actor_user_id: context.userId, tenant_id: null, scope: "platform",
        action: "llm.rate_limits.update", resource_type: "platform_ai_settings",
        context: patch,
      } as any);
      return { ok: true };
    }
    if (!data.tenant_id) throw new Error("tenant_id required");
    if (!(await isTenantAdmin(context, data.tenant_id)) && !(await isPlatformAdmin(context))) throw new Error("Forbidden");
    const { error } = await context.supabase
      .from("tenant_ai_settings")
      .upsert({ tenant_id: data.tenant_id, ...patch }, { onConflict: "tenant_id" });
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "llm.rate_limits.update", resource_type: "tenant_ai_settings",
      context: patch,
    } as any);
    return { ok: true };
  });
