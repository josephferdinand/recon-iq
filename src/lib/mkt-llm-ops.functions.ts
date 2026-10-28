import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { classifyMarketingUsageCost } from "@/lib/mkt-llm-cost";
import { assertMktRoleAssignment } from "./mkt-admin.functions";
import { MKT_TAB_ROLES } from "./mkt-admin-roles";

const PURPOSES = ["chatbot", "kb_embed", "summarize"] as const;
export type LlmPurpose = typeof PURPOSES[number];

/* ---------------- FX settings (USD -> INR) ---------------- */

export const getFxRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("mkt_fx_settings").select("usd_to_inr, updated_at").eq("id", true).maybeSingle();
    return { usd_to_inr: Number(data?.usd_to_inr ?? 83.5), updated_at: data?.updated_at ?? null };
  });

export const setFxRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ usd_to_inr: z.number().positive().max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("mkt_fx_settings")
      .upsert({ id: true, usd_to_inr: data.usd_to_inr, updated_at: new Date().toISOString(), updated_by: context.userId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Routes (primary + 3 fallbacks) ---------------- */

export const listLlmRoutes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("mkt_llm_routes").select("*");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertLlmRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    purpose: z.enum(PURPOSES),
    primary_id: z.string().uuid().nullable(),
    fallback_ids: z.array(z.string().uuid()).max(3).default([]),
    max_cost_per_call: z.number().nonnegative().nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("mkt_llm_routes").upsert({
      purpose: data.purpose,
      primary_id: data.primary_id,
      fallback_ids: data.fallback_ids,
      max_cost_per_call: data.max_cost_per_call ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "purpose" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Provider connectivity test ---------------- */

type ProviderRow = {
  id: string; provider: string; display_name: string;
  base_url: string | null; default_model: string | null; api_key_ref: string | null; enabled: boolean;
};

function resolveBaseUrl(p: ProviderRow): string {
  if (p.base_url) return p.base_url.replace(/\/$/, "");
  switch (p.provider) {
    case "muse": return "https://api.meta.ai/v1";
    case "anthropic": return "https://api.anthropic.com/v1";
    case "google": return "https://generativelanguage.googleapis.com/v1beta/muse";
    case "mistral": return "https://api.mistral.ai/v1";
    case "groq": return "https://api.groq.com/muse/v1";
    case "openrouter": return "https://openrouter.ai/api/v1";
    case "azure_muse": return "";
    default: return "";
  }
}

async function resolveApiKey(p: ProviderRow): Promise<string | null> {
  if (!p.api_key_ref) return null;
  // Vault-only: look up secret via env var name stored in api_key_ref
  const val = process.env[p.api_key_ref];
  return val && val.length > 0 ? val : null;
}

async function testOne(p: ProviderRow): Promise<{ ok: boolean; latency_ms: number; status: number; error?: string; model?: string }> {
  const t0 = Date.now();
  if (!p.enabled) return { ok: false, latency_ms: 0, status: 0, error: "disabled" };
  const url = resolveBaseUrl(p);
  if (!url) return { ok: false, latency_ms: 0, status: 0, error: "missing base_url" };
  const apiKey = await resolveApiKey(p);
  if (!apiKey) return { ok: false, latency_ms: 0, status: 0, error: "missing vault secret (api_key_ref)" };
  const model = p.default_model || "gpt-4o-mini";
  const body = { model, max_tokens: 8, messages: [{ role: "user", content: "ping" }] };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const isAnthropic = p.provider === "anthropic";
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (isAnthropic) {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers["authorization"] = `Bearer ${apiKey}`;
    }
    const endpoint = isAnthropic ? `${url}/messages` : `${url}/chat/completions`;
    const res = await fetch(endpoint, {
      method: "POST", headers,
      body: JSON.stringify(isAnthropic
        ? { model, max_tokens: 8, messages: [{ role: "user", content: "ping" }] }
        : body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const latency = Date.now() - t0;
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { ok: false, latency_ms: latency, status: res.status, error: txt.slice(0, 240), model };
    }
    return { ok: true, latency_ms: latency, status: res.status, model };
  } catch (e) {
    return { ok: false, latency_ms: Date.now() - t0, status: 0, error: (e as Error).message };
  }
}

export const testLlmProviders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ ids: z.array(z.string().uuid()).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("mkt_llm_providers").select("id,provider,display_name,base_url,default_model,api_key_ref,enabled");
    if (data.ids && data.ids.length) q = q.in("id", data.ids);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const results = await Promise.all((rows ?? []).map(async (r: ProviderRow) => ({
      id: r.id, display_name: r.display_name, provider: r.provider,
      ...(await testOne(r)),
    })));
    return results;
  });

export const deleteLlmProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("mkt_llm_providers").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Usage stats (PII-safe aggregate RPC) ---------------- */

export const llmUsageStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ days: z.number().int().min(1).max(365).default(30) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMktRoleAssignment(context, MKT_TAB_ROLES.chatbot);
    const aggregateClient = context.supabase as unknown as {
      rpc: (name: "mkt_llm_usage_stats", args: { _days: number }) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
    const { data: result, error } = await aggregateClient.rpc("mkt_llm_usage_stats", { _days: data.days });
    if (error) throw new Error(error.message);
    return result as {
      restricted: boolean;
      totals: {
        calls: number | null;
        ok_rate: number | null;
        tokens: number | null;
        cost_usd: number | null;
        avg_latency_ms: number | null;
      };
      byProvider: Array<{ id: string; name: string; provider: string; calls: number; ok: number; tokens_in: number; tokens_out: number; cost_usd: number; latency_sum: number }>;
      byDay: Array<{ day: string; cost_usd: number; tokens: number; calls: number }>;
    };
  });
