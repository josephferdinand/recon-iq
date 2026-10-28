/**
 * Centralized AI usage metering + budget enforcement.
 * Server-only helper used by copilot, agent, AIDP and schema_map flows.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type AiScope = "copilot" | "agent" | "aidp" | "schema_map" | "tool" | "other";

export async function checkBudget(supabase: SupabaseClient, tenantId: string): Promise<{
  allowed: boolean; reason?: string;
  todayCost: number; monthCost: number; dailyCap: number; monthlyCap: number;
}> {
  const { data: budget } = await supabase.from("ai_budgets")
    .select("daily_max_tokens, daily_max_cost_usd, monthly_max_cost_usd, hard_stop_at_pct")
    .eq("tenant_id", tenantId).maybeSingle();
  const dailyCap = Number(budget?.daily_max_cost_usd ?? 50);
  const monthlyCap = Number(budget?.monthly_max_cost_usd ?? 1000);
  const hardPct = Number(budget?.hard_stop_at_pct ?? 100) / 100;

  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const { data: rows } = await supabase.from("ai_usage_events")
    .select("cost_usd, created_at")
    .eq("tenant_id", tenantId)
    .gte("created_at", monthStart.toISOString());

  let todayCost = 0, monthCost = 0;
  for (const r of rows ?? []) {
    const c = Number(r.cost_usd ?? 0);
    monthCost += c;
    if (new Date(r.created_at) >= today) todayCost += c;
  }
  if (todayCost >= dailyCap * hardPct) {
    return { allowed: false, reason: `Daily AI budget reached ($${todayCost.toFixed(2)}/$${dailyCap})`, todayCost, monthCost, dailyCap, monthlyCap };
  }
  if (monthCost >= monthlyCap * hardPct) {
    return { allowed: false, reason: `Monthly AI budget reached ($${monthCost.toFixed(2)}/$${monthlyCap})`, todayCost, monthCost, dailyCap, monthlyCap };
  }
  return { allowed: true, todayCost, monthCost, dailyCap, monthlyCap };
}

export async function recordUsage(
  supabase: SupabaseClient,
  args: {
    tenant_id: string;
    user_id?: string | null;
    scope: AiScope;
    model: string;
    tokens_in: number;
    tokens_out: number;
    run_uid?: string | null;
    meta?: Record<string, unknown>;
  },
): Promise<{ cost_usd: number }> {
  const [providerCode, ...modelParts] = args.model.includes("/")
    ? args.model.split("/")
    : ["unknown", args.model];
  const modelKey = modelParts.join("/");
  let priceQuery = supabase.from("ai_model_pricing")
    .select("input_usd_per_1m, output_usd_per_1m")
    .eq("model_key", modelKey)
    .eq("active", true);
  if (providerCode !== "unknown") priceQuery = priceQuery.eq("provider_code", providerCode);
  const { data: price } = await priceQuery.order("effective_at", { ascending: false }).limit(1).maybeSingle();
  const inP = Number(price?.input_usd_per_1m ?? 0);
  const outP = Number(price?.output_usd_per_1m ?? 0);
  const cost = (args.tokens_in / 1_000_000) * inP + (args.tokens_out / 1_000_000) * outP;

  await supabase.from("ai_usage_events").insert({
    tenant_id: args.tenant_id,
    user_id: args.user_id ?? null,
    scope: args.scope,
    model: args.model,
    tokens_in: args.tokens_in,
    tokens_out: args.tokens_out,
    cost_usd: cost,
    run_uid: args.run_uid ?? null,
    meta: args.meta ?? {},
  } as any);
  return { cost_usd: cost };
}

export async function effectiveAiPolicy(supabase: SupabaseClient, tenantId: string) {
  const [{ data: plat }, { data: ten }, { data: entRows }] = await Promise.all([
    supabase.from("platform_ai_settings").select("*").eq("id", true).maybeSingle(),
    supabase.from("tenant_ai_settings").select("*").eq("tenant_id", tenantId).maybeSingle(),
    supabase.from("tenant_feature_entitlements").select("feature_key, allowed").eq("tenant_id", tenantId),
  ]);
  const ent = new Map((entRows ?? []).map((r: any) => [r.feature_key, r.allowed]));
  const platOn = (k: string) => (plat ? (plat as any)[k] !== false : true);
  const tenOn = (k: string, dflt = true) => (ten ? (ten as any)[k] !== false : dflt);
  return {
    allow_copilot: platOn("allow_copilot_global") && tenOn("allow_copilot") && (ent.get("copilot") ?? true),
    allow_agent: platOn("allow_agent_global") && tenOn("allow_agent") && (ent.get("agent") ?? true),
    allow_auto_remediation: platOn("allow_auto_remediation_global") && tenOn("allow_auto_remediation", false) && (ent.get("auto_remediation") ?? true),
    allow_byo_llm: platOn("allow_byo_llm_global") && tenOn("allow_byo_llm") && (ent.get("byo_llm") ?? true),
    force_pii_redaction: !!plat?.force_pii_redaction || !!ten?.redact_pii_default,
    default_model: ten?.default_model ?? plat?.default_model ?? "google/gemini-3-flash-preview",
    allowed_models: (ten?.allowed_models?.length ? ten.allowed_models : plat?.global_allowed_models) ?? [],
  };
}
