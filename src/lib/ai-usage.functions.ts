import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getBudget = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) =>
    z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("ai_budgets").select("*").eq("tenant_id", data.tenant_id).maybeSingle();
    return row ?? {
      tenant_id: data.tenant_id,
      daily_max_tokens: 1_000_000,
      daily_max_cost_usd: 50,
      monthly_max_cost_usd: 1000,
      alert_at_pct: 80, hard_stop_at_pct: 100,
    };
  });

const BSchema = z.object({
  tenant_id: z.string().uuid(),
  daily_max_tokens: z.number().int().min(1000),
  daily_max_cost_usd: z.number().min(0),
  monthly_max_cost_usd: z.number().min(0),
  alert_at_pct: z.number().int().min(1).max(100),
  hard_stop_at_pct: z.number().int().min(1).max(100),
});
export const upsertBudget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => BSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: ok } = await context.supabase.rpc("has_tenant_role", {
      _user_id: context.userId, _tenant_id: data.tenant_id, _role: "tenant_admin",
    });
    if (!ok) throw new Error("Forbidden: tenant_admin required");
    const { error } = await context.supabase.from("ai_budgets")
      .upsert({ ...data, updated_by: context.userId, updated_at: new Date().toISOString() } as any,
        { onConflict: "tenant_id" });
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "ai_budget.update", resource_type: "ai_budgets", resource_id: data.tenant_id,
      context: { daily_max_cost_usd: data.daily_max_cost_usd },
    } as any);
    return { ok: true };
  });

export const getUsageStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; days?: number }) =>
    z.object({ tenant_id: z.string().uuid(), days: z.number().int().min(1).max(90).default(30) }).parse(d))
  .handler(async ({ data, context }) => {
    const since = new Date(Date.now() - data.days * 86400_000).toISOString();
    const { data: events } = await context.supabase.from("ai_usage_events")
      .select("created_at, scope, model, tokens_in, tokens_out, cost_usd")
      .eq("tenant_id", data.tenant_id)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5000);

    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    let todayTokens = 0, todayCost = 0, monthCost = 0;
    const byDay: Record<string, { tokens: number; cost: number }> = {};
    const byModel: Record<string, { tokens: number; cost: number; count: number }> = {};
    const byScope: Record<string, { tokens: number; cost: number; count: number }> = {};
    for (const e of events ?? []) {
      const tk = (e.tokens_in ?? 0) + (e.tokens_out ?? 0);
      const cost = Number(e.cost_usd ?? 0);
      const d = String(e.created_at).slice(0, 10);
      byDay[d] = byDay[d] || { tokens: 0, cost: 0 };
      byDay[d].tokens += tk; byDay[d].cost += cost;
      byModel[e.model] = byModel[e.model] || { tokens: 0, cost: 0, count: 0 };
      byModel[e.model].tokens += tk; byModel[e.model].cost += cost; byModel[e.model].count += 1;
      byScope[e.scope] = byScope[e.scope] || { tokens: 0, cost: 0, count: 0 };
      byScope[e.scope].tokens += tk; byScope[e.scope].cost += cost; byScope[e.scope].count += 1;
      const dt = new Date(e.created_at);
      if (dt >= today) { todayTokens += tk; todayCost += cost; }
      if (dt >= monthStart) { monthCost += cost; }
    }
    return {
      todayTokens, todayCost, monthCost,
      byDay: Object.entries(byDay).map(([d, v]) => ({ date: d, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
      byModel: Object.entries(byModel).map(([m, v]) => ({ model: m, ...v })),
      byScope: Object.entries(byScope).map(([s, v]) => ({ scope: s, ...v })),
      recent: (events ?? []).slice(0, 50),
    };
  });
