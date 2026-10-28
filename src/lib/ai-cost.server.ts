/**
 * AI model cost calculator.
 *
 * Computes USD cost for AI inference usage from token counts and model key.
 * Pricing is configured in the DB (`ai_model_pricing` table) so finance can
 * update rates without code changes. An in-process cache avoids hitting the
 * DB on every request.
 *
 * Cache is invalidated whenever the rate-card version env var changes or
 * after TTL expires.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type ModelPricing = {
  model_key: string;
  provider_code: string;
  input_usd_per_1m: number;
  output_usd_per_1m: number;
  effective_at: string;
};

const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { version: number | string; loadedAt: number; rows: Map<string, ModelPricing> } | null = null;

async function loadPricing(sb: SupabaseClient): Promise<Map<string, ModelPricing>> {
  const version = process.env.FVI_AI_PRICING_VERSION || "default";
  const now = Date.now();
  if (cache && cache.version === version && now - cache.loadedAt < CACHE_TTL_MS) {
    return cache.rows;
  }
  const { data } = await sb.from("ai_model_pricing")
    .select("model_key, provider_code, input_usd_per_1m, output_usd_per_1m, effective_at")
    .eq("active", true);
  const rows = new Map<string, ModelPricing>();
  for (const r of (data ?? []) as unknown as ModelPricing[]) {
    rows.set(`${r.provider_code}/${r.model_key}`, r);
    rows.set(r.model_key, r); // also keyed by model_key alone for ad-hoc lookups
  }
  cache = { version, loadedAt: now, rows };
  return rows;
}

/**
 * Compute USD cost for a single inference call.
 *
 * Returns 0 if no pricing row matches — callers can detect this and surface
 * an "unpriced" annotation. Never throws on missing pricing.
 */
export async function computeUsageCostUsd(
  sb: SupabaseClient,
  providerCode: string,
  modelKey: string,
  tokensIn: number,
  tokensOut: number,
): Promise<{ cost_usd: number; priced: boolean; rate_card_key: string | null }> {
  try {
    const rows = await loadPricing(sb);
    const row = rows.get(`${providerCode}/${modelKey}`) ?? rows.get(modelKey) ?? null;
    if (!row) return { cost_usd: 0, priced: false, rate_card_key: null };

    const inCost = (Math.max(0, tokensIn) / 1_000_000) * Number(row.input_usd_per_1m);
    const outCost = (Math.max(0, tokensOut) / 1_000_000) * Number(row.output_usd_per_1m);
    // Round to 6 decimal places (sub-cent precision, accounting-safe)
    const cost_usd = Number((inCost + outCost).toFixed(6));
    return { cost_usd, priced: true, rate_card_key: `${providerCode}/${modelKey}` };
  } catch {
    return { cost_usd: 0, priced: false, rate_card_key: null };
  }
}

/**
 * Test/script helper: force the pricing cache to reload.
 */
export function invalidatePricingCache(): void {
  cache = null;
}
