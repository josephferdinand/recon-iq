import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Platform-wide AI usage & cost analytics.
 * Aggregates ai_usage_events across all tenants for platform_admin dashboards.
 */

const InputSchema = z.object({
  days: z.number().int().min(1).max(90).default(30),
  tenant_id: z.string().uuid().nullish(),
});

type Bucket = { tokens_in: number; tokens_out: number; tokens: number; cost_usd: number; count: number };
const empty = (): Bucket => ({ tokens_in: 0, tokens_out: 0, tokens: 0, cost_usd: 0, count: 0 });
const add = (b: Bucket, e: { tokens_in?: number | null; tokens_out?: number | null; cost_usd?: number | string | null }) => {
  const ti = Number(e.tokens_in ?? 0), to = Number(e.tokens_out ?? 0);
  b.tokens_in += ti; b.tokens_out += to; b.tokens += ti + to;
  b.cost_usd += Number(e.cost_usd ?? 0); b.count += 1;
};
const providerOf = (model: string) => (model?.includes("/") ? model.split("/")[0] : "unknown");

export const getPlatformAiUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => InputSchema.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_platform_admin", { _user_id: context.userId });
    if (!isAdmin) throw new Error("Forbidden: platform_admin required");

    const since = new Date(Date.now() - data.days * 86400_000).toISOString();
    const [{ data: fx }, { data: pricing }, { data: tenantsList }] = await Promise.all([
      context.supabase.from("mkt_fx_settings").select("usd_to_inr").maybeSingle(),
      context.supabase
        .from("ai_model_pricing")
        .select("provider_code,model_key,input_usd_per_1m,output_usd_per_1m")
        .eq("active", true),
      context.supabase.from("tenants").select("id,name,slug"),
    ]);
    const usdToInr = Number(fx?.usd_to_inr ?? 83.5);
    const tenantMap = new Map<string, { name: string; slug: string }>(
      (tenantsList ?? []).map((t: any) => [t.id, { name: t.name, slug: t.slug }]),
    );

    let q = context.supabase
      .from("ai_usage_events")
      .select("created_at,tenant_id,user_id,scope,model,tokens_in,tokens_out,cost_usd")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20000);
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    const { data: events, error } = await q;
    if (error) throw new Error(error.message);

    const now = new Date();
    const startToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const startMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const start7 = new Date(now.getTime() - 7 * 86400_000);
    const start24 = new Date(now.getTime() - 86400_000);
    const start48to24 = new Date(now.getTime() - 2 * 86400_000);

    const totals = empty();
    const today = empty();
    const month = empty();
    const last7 = empty();
    const last24 = empty();
    const prev24 = empty();
    const byDay = new Map<string, Bucket>();
    const byProvider = new Map<string, Bucket>();
    const byModel = new Map<string, Bucket>();
    const byScope = new Map<string, Bucket>();
    const byTenant = new Map<string, Bucket>();
    const byUser = new Map<string, Bucket>();

    for (const e of (events ?? []) as any[]) {
      add(totals, e);
      const dt = new Date(e.created_at);
      if (dt >= startToday) add(today, e);
      if (dt >= startMonth) add(month, e);
      if (dt >= start7) add(last7, e);
      if (dt >= start24) add(last24, e);
      else if (dt >= start48to24) add(prev24, e);

      const dayKey = String(e.created_at).slice(0, 10);
      const bk = (m: Map<string, Bucket>, k: string) => {
        let x = m.get(k); if (!x) { x = empty(); m.set(k, x); } return x;
      };
      add(bk(byDay, dayKey), e);
      add(bk(byProvider, providerOf(e.model)), e);
      add(bk(byModel, e.model || "unknown"), e);
      add(bk(byScope, e.scope || "other"), e);
      add(bk(byTenant, e.tenant_id), e);
      if (e.user_id) add(bk(byUser, e.user_id), e);
    }

    // Fill missing days for smooth chart
    const daySeries: { date: string; cost_usd: number; cost_inr: number; tokens: number; count: number }[] = [];
    for (let i = data.days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400_000);
      const key = d.toISOString().slice(0, 10);
      const b = byDay.get(key) ?? empty();
      daySeries.push({ date: key, cost_usd: +b.cost_usd.toFixed(6), cost_inr: +(b.cost_usd * usdToInr).toFixed(2), tokens: b.tokens, count: b.count });
    }

    const toRows = (m: Map<string, Bucket>) =>
      Array.from(m.entries()).map(([key, v]) => ({
        key,
        tokens_in: v.tokens_in,
        tokens_out: v.tokens_out,
        tokens: v.tokens,
        cost_usd: +v.cost_usd.toFixed(6),
        cost_inr: +(v.cost_usd * usdToInr).toFixed(2),
        count: v.count,
      })).sort((a, b) => b.cost_usd - a.cost_usd);

    const providersArr = toRows(byProvider).map((r) => ({ provider: r.key, tokens_in: r.tokens_in, tokens_out: r.tokens_out, tokens: r.tokens, cost_usd: r.cost_usd, cost_inr: r.cost_inr, count: r.count }));
    const modelsArr = toRows(byModel).map((r) => ({ model: r.key, provider: providerOf(r.key), tokens_in: r.tokens_in, tokens_out: r.tokens_out, tokens: r.tokens, cost_usd: r.cost_usd, cost_inr: r.cost_inr, count: r.count }));
    const scopesArr = toRows(byScope).map((r) => ({ scope: r.key, tokens_in: r.tokens_in, tokens_out: r.tokens_out, tokens: r.tokens, cost_usd: r.cost_usd, cost_inr: r.cost_inr, count: r.count }));
    const tenantsArr = toRows(byTenant).slice(0, 25).map((r) => ({
      tenant_id: r.key,
      tenant_name: tenantMap.get(r.key)?.name ?? "Unknown",
      tenant_slug: tenantMap.get(r.key)?.slug ?? "",
      tokens_in: r.tokens_in, tokens_out: r.tokens_out, tokens: r.tokens,
      cost_usd: r.cost_usd, cost_inr: r.cost_inr, count: r.count,
    }));
    const usersArr = toRows(byUser).slice(0, 20).map((r) => ({
      user_id: r.key,
      tokens_in: r.tokens_in, tokens_out: r.tokens_out, tokens: r.tokens,
      cost_usd: r.cost_usd, cost_inr: r.cost_inr, count: r.count,
    }));

    // Insights
    const insights: { severity: "info" | "success" | "warn" | "critical"; title: string; detail: string }[] = [];
    const trendPct = prev24.cost_usd > 0
      ? ((last24.cost_usd - prev24.cost_usd) / prev24.cost_usd) * 100
      : (last24.cost_usd > 0 ? 100 : 0);
    if (Math.abs(trendPct) >= 25 && last24.cost_usd > 0.5) {
      insights.push({
        severity: trendPct > 0 ? "warn" : "success",
        title: `Spend ${trendPct > 0 ? "surged" : "dropped"} ${Math.abs(trendPct).toFixed(0)}% in the last 24h`,
        detail: `24h: $${last24.cost_usd.toFixed(4)} vs prior 24h: $${prev24.cost_usd.toFixed(4)}. Review model routing and prompt sizes.`,
      });
    }
    const topModel = modelsArr[0];
    if (topModel && totals.cost_usd > 0) {
      const share = (topModel.cost_usd / totals.cost_usd) * 100;
      if (share >= 60) {
        insights.push({
          severity: "info",
          title: `${topModel.model} concentrates ${share.toFixed(0)}% of spend`,
          detail: `Consider routing routine tasks to a cheaper equivalent (e.g. -mini/-flash-lite) to reduce blended cost.`,
        });
      }
    }
    // Expensive model recommendations
    const expensive = modelsArr.filter((m: any) => /gpt-5$|gemini-2\.5-pro/.test(m.model) && m.count > 0);
    for (const m of expensive) {
      const alt = m.model.includes("gpt-5") ? "muse/gpt-5-mini" : "google/gemini-2.5-flash";
      const priceRow = (pricing ?? []).find((p) => `${p.provider_code}/${p.model_key}` === m.model || p.model_key === m.model);
      const altPriceRow = (pricing ?? []).find((p) => `${p.provider_code}/${p.model_key}` === alt || p.model_key === alt);
      if (priceRow && altPriceRow) {
        const cur = (m.tokens_in / 1_000_000) * Number(priceRow.input_usd_per_1m) + (m.tokens_out / 1_000_000) * Number(priceRow.output_usd_per_1m);
        const proj = (m.tokens_in / 1_000_000) * Number(altPriceRow.input_usd_per_1m) + (m.tokens_out / 1_000_000) * Number(altPriceRow.output_usd_per_1m);
        const save = cur - proj;
        if (save > 0.05) {
          insights.push({
            severity: "info",
            title: `Potential $${save.toFixed(2)} (₹${(save * usdToInr).toFixed(0)}) saved by routing simple ${m.model} calls to ${alt}`,
            detail: `Applied to the last ${data.days} days at current token mix. Use governance routing rules to auto-downshift low-complexity requests.`,
          });
        }
      }
    }
    const topTenant = tenantsArr[0];
    if (topTenant && totals.cost_usd > 0 && (topTenant.cost_usd / totals.cost_usd) >= 0.5 && tenantsArr.length > 1) {
      insights.push({
        severity: "warn",
        title: `Tenant "${topTenant.tenant_name}" drives ${((topTenant.cost_usd / totals.cost_usd) * 100).toFixed(0)}% of platform AI spend`,
        detail: `Verify their AI budget cap and daily rate limits are configured appropriately.`,
      });
    }
    if (totals.count === 0) {
      insights.push({
        severity: "info",
        title: "No AI usage recorded in this window",
        detail: `Metering hooks emit into ai_usage_events on every Copilot / Agent / AIDP call. Once traffic starts, this dashboard populates automatically.`,
      });
    } else {
      insights.push({
        severity: "success",
        title: `Blended cost per 1K tokens: $${totals.tokens > 0 ? ((totals.cost_usd / totals.tokens) * 1000).toFixed(4) : "0.0000"}`,
        detail: `Across ${totals.count.toLocaleString()} calls, ${totals.tokens.toLocaleString()} tokens, ${providersArr.length} providers.`,
      });
    }

    return {
      window_days: data.days,
      usd_to_inr: usdToInr,
      generated_at: new Date().toISOString(),
      totals: {
        cost_usd: +totals.cost_usd.toFixed(6),
        cost_inr: +(totals.cost_usd * usdToInr).toFixed(2),
        tokens: totals.tokens,
        tokens_in: totals.tokens_in,
        tokens_out: totals.tokens_out,
        count: totals.count,
        avg_cost_per_call_usd: totals.count > 0 ? +(totals.cost_usd / totals.count).toFixed(6) : 0,
        cost_per_1k_tokens_usd: totals.tokens > 0 ? +((totals.cost_usd / totals.tokens) * 1000).toFixed(6) : 0,
      },
      today: { cost_usd: +today.cost_usd.toFixed(6), cost_inr: +(today.cost_usd * usdToInr).toFixed(2), tokens: today.tokens, count: today.count },
      month: { cost_usd: +month.cost_usd.toFixed(6), cost_inr: +(month.cost_usd * usdToInr).toFixed(2), tokens: month.tokens, count: month.count },
      last7d: { cost_usd: +last7.cost_usd.toFixed(6), cost_inr: +(last7.cost_usd * usdToInr).toFixed(2), tokens: last7.tokens, count: last7.count },
      last24h: { cost_usd: +last24.cost_usd.toFixed(6), cost_inr: +(last24.cost_usd * usdToInr).toFixed(2), tokens: last24.tokens, count: last24.count },
      trend_24h_pct: +trendPct.toFixed(2),
      daySeries,
      byProvider: providersArr,
      byModel: modelsArr.slice(0, 25),
      byScope: scopesArr,
      byTenant: tenantsArr,
      topUsers: usersArr,
      pricing: (pricing ?? []).map((p: any) => ({
        model: `${p.provider_code}/${p.model_key}`,
        provider: p.provider_code,
        input_per_1k_usd: Number(p.input_usd_per_1m) / 1000,
        output_per_1k_usd: Number(p.output_usd_per_1m) / 1000,
        input_per_1k_inr: +((Number(p.input_usd_per_1m) / 1000) * usdToInr).toFixed(4),
        output_per_1k_inr: +((Number(p.output_usd_per_1m) / 1000) * usdToInr).toFixed(4),
      })),
      insights,
    };
  });
