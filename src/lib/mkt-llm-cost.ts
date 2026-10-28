export type MarketingTokenPricing = {
  input_usd_per_million?: number | null;
  output_usd_per_million?: number | null;
} | null | undefined;

export type MarketingCostStatus = "priced" | "unpriced" | "unverified";

export function classifyMarketingUsageCost(event: {
  cost_usd: number | string | null;
  error_code?: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
}): MarketingCostStatus {
  if (event.error_code === "pricing_not_configured") return "unpriced";
  if (Number(event.cost_usd ?? 0) === 0 && (event.tokens_in ?? 0) + (event.tokens_out ?? 0) > 0) {
    return "unverified";
  }
  return "priced";
}

export function estimateMarketingCallCost(
  pricing: MarketingTokenPricing,
  tokensIn: number,
  tokensOut: number,
): { cost_usd: number; priced: boolean } {
  const inputRate = pricing?.input_usd_per_million;
  const outputRate = pricing?.output_usd_per_million;
  const priced = typeof inputRate === "number" && Number.isFinite(inputRate) && inputRate >= 0
    && typeof outputRate === "number" && Number.isFinite(outputRate) && outputRate >= 0
    && (inputRate > 0 || outputRate > 0);

  if (!priced) return { cost_usd: 0, priced: false };
  return {
    cost_usd: (Math.max(0, tokensIn) * inputRate + Math.max(0, tokensOut) * outputRate) / 1_000_000,
    priced: true,
  };
}
