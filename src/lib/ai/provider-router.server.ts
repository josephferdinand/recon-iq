/**
 * ReconIQ AI Provider Router (server-only).
 *
 * Enterprise-owned AI routing layer. Resolves the active AI provider from
 * DB-backed metadata (`llm_providers`) and returns an Muse-compatible
 * client bound to the provider's real base URL and credentials fetched
 * from the Enterprise Secret Vault.
 *
 * This module is the sole runtime entry point for AI provider access.
 * No hardcoded provider endpoints, credentials, or third-party gateways.
 */

import { createMuseCompatible, getAiProxyConfig } from "@/lib/ai/muse-provider.server";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ResidencyContext = {
  tenantId?: string;
  allowedRegions?: string[];
  modelAllowedRegions?: string[];
  pinnedPii?: boolean;
};

/**
 * Neutral last-resort base URL. Used only if the DB is completely empty
 * and the platform still needs to resolve an Muse-compatible endpoint.
 * Prefer configuring providers explicitly in `llm_providers`.
 */
export const FVI_AI_DEFAULT_BASE_URL =
  process.env.META_API_BASE_URL?.trim() || "https://api.meta.ai/v1";

/**
 * Resolve the active AI gateway base URL from `llm_providers`. Selects the
 * most recent active provider row. Falls back to FVI_AI_DEFAULT_BASE_URL
 * only if no row exists.
 */
export async function resolveFviAiBaseUrl(
  supabase: Pick<SupabaseClient, "from">,
): Promise<string> {
  try {
    const { data } = await (supabase as SupabaseClient)
      .from("llm_providers")
      .select("base_url,provider")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const base = (data as { base_url?: string | null } | null)?.base_url;
    if (base && /^https?:\/\//i.test(base)) return base.replace(/\/+$/, "");
  } catch {
    /* fall through */
  }
  // DB routing wins; the env proxy is only the platform fallback when no DB row exists.
  return getAiProxyConfig()?.baseUrl || FVI_AI_DEFAULT_BASE_URL;
}

/**
 * Hard residency check applied BEFORE any upstream fetch.
 */
export function assertResidencyCompliant(ctx: ResidencyContext, model: string): void {
  const tenantRegions = (ctx.allowedRegions ?? []).filter(Boolean);
  if (tenantRegions.length === 0) return;
  const modelRegions = (ctx.modelAllowedRegions ?? []).filter(Boolean);
  if (modelRegions.length === 0) {
    throw new Error(
      `Residency violation: model "${model}" has no declared regions; tenant requires ${tenantRegions.join(",")}.`,
    );
  }
  const effectiveModel = ctx.pinnedPii ? modelRegions.filter((r) => r !== "global") : modelRegions;
  const overlap = effectiveModel.some((r) => tenantRegions.includes(r));
  if (!overlap) {
    throw new Error(
      `Residency violation: model "${model}" runs in [${modelRegions.join(",")}] but tenant requires [${tenantRegions.join(",")}].`,
    );
  }
}

/**
 * Create an Muse-compatible AI provider bound to a direct upstream.
 * Credentials come from the caller (fetched from the Enterprise Secret
 * Vault or a governed env var). No third-party gateway hop.
 */
export function createFviAiProvider(
  apiKey: string,
  residency?: ResidencyContext,
  baseURL: string = FVI_AI_DEFAULT_BASE_URL,
) {
  const proxy = getAiProxyConfig();
  // Proxy when the resolved base is the proxy base or no DB base was pinned
  // (default). A distinct DB-configured base URL is never hijacked.
  const useProxy = !!proxy && (baseURL.replace(/\/+$/, "") === proxy.baseUrl || baseURL === FVI_AI_DEFAULT_BASE_URL);
  const base = createMuseCompatible({
    name: "fvi-ai",
    ...(useProxy ? { proxy: true, apiKey: proxy.apiKey } : {}),
    baseURL: useProxy ? proxy.baseUrl : baseURL,
    headers: {
      Authorization: `Bearer ${useProxy ? proxy.apiKey : apiKey}`,
      "X-FVI-AI-Client": "fvi-platform",
    },
  });
  if (!residency) return base;
  return ((modelId: string) => {
    assertResidencyCompliant(residency, modelId);
    return base(modelId);
  }) as typeof base;
}

/**
 * Resolve the platform-managed AI API key. The optional AI proxy
 * (AI_API_BASE_URL + AI_API_KEY) wins when configured; otherwise the Meta
 * Muse key (META_API_KEY). Throws in production if neither is set so the
 * worker refuses to start rather than silently routing through an
 * unconfigured provider.
 */
export function resolvePlatformAiApiKey(): string | undefined {
  const proxy = getAiProxyConfig();
  if (proxy) return proxy.apiKey;
  const key = process.env.META_API_KEY?.trim();
  if (!key && process.env.NODE_ENV === 'production') {
    throw new Error('META_API_KEY (or the AI_API_* proxy pair) is required in production — refusing to start without AI credentials');
  }
  return key || undefined;
}
