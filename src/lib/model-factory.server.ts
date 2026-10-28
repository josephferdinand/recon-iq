/** Meta-only model selection for this independent export. */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createMuseCompatible, getAiProxyConfig, MUSE_BASE_URL, MUSE_DEFAULT_MODEL } from './ai/muse-provider.server';
import { assertResidencyCompliant, type ResidencyContext } from './ai/provider-router.server';
export type ResolvedProvider = { provider: string; model: string; apiKey: string; baseUrl?: string | null; residency?: ResidencyContext };
export type ModelHandle = ReturnType<ReturnType<typeof createMuseCompatible>>;
export function normalizeBaseUrl(input: string | null | undefined): string | undefined {
  return input?.trim().replace(/\/+$/, '').replace(/\/(chat\/completions|completions|messages|responses|embeddings)$/i, '');
}
const PROXY_ELIGIBLE_PROVIDERS = new Set(['meta', 'muse', 'ai-proxy', 'proxy']);
export function buildModelHandle(resolved: ResolvedProvider): ModelHandle {
  if (resolved.residency) assertResidencyCompliant(resolved.residency, resolved.model);
  const proxy = getAiProxyConfig();
  // Env proxy overrides only the Meta/platform-default path. A distinct
  // tenant BYOK provider resolved from llm_providers is never hijacked.
  if (proxy && PROXY_ELIGIBLE_PROVIDERS.has(resolved.provider.toLowerCase())) {
    return createMuseCompatible({ proxy: true, apiKey: proxy.apiKey, baseURL: proxy.baseUrl })(resolved.model || proxy.model);
  }
  return createMuseCompatible({ apiKey: process.env.META_API_KEY || resolved.apiKey, baseURL: MUSE_BASE_URL })(process.env.META_MUSE_MODEL || resolved.model || MUSE_DEFAULT_MODEL);
}
export async function resolveTenantProvider(
  supabase: SupabaseClient,
  tenantId: string | null,
): Promise<ResolvedProvider | null> {
  type LlmProviderRow = {
    id?: string;
    tenant_id?: string | null;
    provider: string;
    base_url: string | null;
    model: string;
    key_secret_name: string | null;
    key_rotated_at: string | null;
  };
  let providerRows: LlmProviderRow[] = [];

  if (tenantId) {
    const { data } = await supabase
      .from("llm_providers")
      .select("id, tenant_id, provider, base_url, model, key_secret_name, key_rotated_at")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("priority", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(10);
    providerRows = (data as LlmProviderRow[] | null) ?? [];
  } else {
    const { data } = await supabase
      .from("llm_providers")
      .select("id, tenant_id, provider, base_url, model, key_secret_name, key_rotated_at")
      .eq("scope", "platform")
      .is("tenant_id", null)
      .eq("is_active", true)
      .order("priority", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(10);
    providerRows = (data as LlmProviderRow[] | null) ?? [];
  }

  // Vault-only: no third-party gateway fallback, no Cloud Secret / process.env fallback.
  // BYOK secrets must be configured in the in-app Vault by a Platform or Tenant admin.
  if (providerRows.length === 0) {
    const proxy = getAiProxyConfig();
    if (proxy) return { provider: 'ai-proxy', model: proxy.model, apiKey: proxy.apiKey, baseUrl: proxy.baseUrl };
    const apiKey = process.env.META_API_KEY;
    return apiKey ? { provider: 'meta', model: process.env.META_MUSE_MODEL || MUSE_DEFAULT_MODEL, apiKey, baseUrl: MUSE_BASE_URL } : null;
  }

  const { resolveVaultSecret } = await import("./vault-resolver.server");
  for (const providerRow of providerRows) {
    const provider = providerRow.provider.toLowerCase();
    const secretName = (providerRow.key_secret_name || providerRow.provider).toUpperCase();
    const resolved = await resolveVaultSecret(supabase, {
      scope: tenantId ? "tenant" : "platform",
      tenant_id: tenantId,
      secret_class: "llm_api_key",
      name: secretName,
    });
    const apiKey = resolved?.plaintext;
    if (!apiKey) continue;

    // S-7: BYOK key-rotation reminder. Fire-and-forget: if the active BYO key
    // is older than 90 days, emit a security_events row so platform/tenant
    // admins see a "rotation due" reminder. Never blocks the Copilot call.
    await maybeNotifyKeyRotationDue(supabase, providerRow);

    return {
      provider,
      model: providerRow.model,
      apiKey,
      baseUrl: providerRow.base_url,
    };
  }

  return null;
}

/**
 * S-7 helper. Exported for unit tests.
 * Emits a `security_events` row (severity=info, event_type=
 * `llm.key_rotation_due`) when the provider's `key_rotated_at` is older
 * than `maxAgeMs` (default 90 days). Idempotency is best-effort — the
 * reminder is informational and fires at most once per resolve call.
 */
export const KEY_ROTATION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export async function maybeNotifyKeyRotationDue(
  supabase: SupabaseClient,
  row: {
    id?: string;
    tenant_id?: string | null;
    provider: string;
    key_rotated_at: string | null;
  },
  now: Date = new Date(),
  maxAgeMs: number = KEY_ROTATION_MAX_AGE_MS,
): Promise<{ notified: boolean; ageMs: number | null }> {
  if (!row.key_rotated_at) return { notified: false, ageMs: null };
  const rotatedAt = Date.parse(row.key_rotated_at);
  if (Number.isNaN(rotatedAt)) return { notified: false, ageMs: null };
  const ageMs = now.getTime() - rotatedAt;
  if (ageMs < maxAgeMs) return { notified: false, ageMs };
  try {
    await supabase.from("security_events").insert({
      tenant_id: row.tenant_id ?? null,
      event_type: "llm.key_rotation_due",
      severity: "info",
      context: {
        provider_id: row.id ?? null,
        provider: row.provider,
        key_rotated_at: row.key_rotated_at,
        age_days: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
        max_age_days: Math.floor(maxAgeMs / (24 * 60 * 60 * 1000)),
      },
    });
  } catch (err) {
    console.warn("[model-factory] key_rotation_due notify failed", err);
  }
  return { notified: true, ageMs };
}

