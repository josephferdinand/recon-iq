// AI Model Catalog — curated registry of models exposed to tenants for
// selection in Copilot, Agents, and reconciliation pipelines. Each entry is
// tagged so operators can filter by provider, capability, tier, and modality
// and wire the model into the LLM chain (see LlmTab).

export type ProviderKey =
  | "anthropic"
  | "muse"
  | "google"
  | "qwen"
  | "zhipu"
  | "minimax"
  | "deepseek"
  | "meta"
  | "mistral"
  | "custom_muse_compatible";

export type Capability =
  | "reasoning"
  | "coding"
  | "vision"
  | "audio"
  | "long-context"
  | "fast"
  | "cost-efficient"
  | "agentic"
  | "structured-output"
  | "tool-use"
  | "multilingual";

export type Tier = "flagship" | "balanced" | "efficient" | "preview";

export type ModelEntry = {
  id: string;                 // stable id used when wiring into LLM chain
  displayName: string;
  provider: ProviderKey;
  providerLabel: string;
  tier: Tier;
  contextWindow: number;      // tokens
  releaseTag?: "new" | "beta" | "preview" | "ga";
  description: string;
  capabilities: Capability[];
  modalities: Array<"text" | "image" | "audio" | "video">;
  pricing?: { inputPer1M?: number; outputPer1M?: number; currency?: "USD" };
  recommendedFor: string[];
  requiresBYOK?: boolean;
  aliasOf?: string;           // when this is a rebrand / alias of another sku
};

export const PROVIDER_META: Record<ProviderKey, { label: string; color: string }> = {
  anthropic: { label: "Anthropic",  color: "hsl(24 90% 55%)" },
  muse:    { label: "Muse",     color: "hsl(160 60% 40%)" },
  google:    { label: "Google DeepMind", color: "hsl(217 90% 60%)" },
  qwen:      { label: "Alibaba Qwen", color: "hsl(280 70% 55%)" },
  zhipu:     { label: "Zhipu / GLM", color: "hsl(200 80% 45%)" },
  minimax:   { label: "MiniMax",    color: "hsl(340 75% 55%)" },
  deepseek:  { label: "DeepSeek",   color: "hsl(255 70% 60%)" },
  meta:      { label: "Meta",       color: "hsl(220 85% 55%)" },
  mistral:   { label: "Mistral AI", color: "hsl(15 90% 55%)" },
  custom_muse_compatible: { label: "Custom (Muse-compatible)", color: "hsl(0 0% 45%)" },
};

export const AI_MODEL_CATALOG: ModelEntry[] = [{
  id: 'muse-spark-1.3', displayName: 'Muse Spark', provider: 'meta', providerLabel: 'Meta',
  tier: 'flagship', contextWindow: 0,
  description: 'Meta model for reconciliation assistance. Confirm limits and availability in your account.',
  capabilities: ['reasoning', 'structured-output', 'tool-use'], modalities: ['text', 'image'],
  recommendedFor: ['Field mapping', 'Break investigation', 'Evidence-based explanations'], requiresBYOK: true,
}];

export function filterCatalog(
  items: ModelEntry[],
  q: { search?: string; provider?: ProviderKey | "all"; tier?: Tier | "all"; capability?: Capability | "all" },
) {
  const search = q.search?.trim().toLowerCase() ?? "";
  return items.filter((m) => {
    if (q.provider && q.provider !== "all" && m.provider !== q.provider) return false;
    if (q.tier && q.tier !== "all" && m.tier !== q.tier) return false;
    if (q.capability && q.capability !== "all" && !m.capabilities.includes(q.capability)) return false;
    if (search) {
      const hay = `${m.displayName} ${m.id} ${m.providerLabel} ${m.description}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}
