/**
 * Phase 5 — Platform observability queries.
 *
 * Three platform-admin-only reads that power the consolidated
 * monitoring dashboard at `/$slug/monitoring/copilot`:
 *
 *   - getTopTenantsByAICost(window_days)
 *   - getTopToolsByErrorRate(window_hours)
 *   - getSlowestToolsByP95(window_hours)
 *
 * All three:
 *   - require an authenticated session (via requireSupabaseAuth),
 *   - hard-fail if the caller is not `is_platform_admin`,
 *   - perform read-only aggregations over `ai_usage_events`,
 *   - never echo per-row PII (tenant_id is the most granular field).
 *
 * The dashboard surfaces these alongside per-tool metrics so the
 * platform team can answer "which tenant is burning credits", "which
 * tool is breaking", and "which tool is slow" in a single page.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Inlined per call-site because the Supabase client RPC typings expect a
// narrow `FnName` literal that is awkward to forward through a generic
// helper without leaking project-wide types.

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

// ─── 1. Top tenants by AI cost ──────────────────────────────────────────────
export type TopTenantByCost = {
  tenant_id: string;
  cost_usd: number;
  call_count: number;
};

export const getTopTenantsByAICost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ window_days: z.number().int().min(1).max(90).default(7) }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<TopTenantByCost[]> => {
    { const { data: isPlat } = await context.supabase.rpc("is_platform_admin", { _user_id: context.userId }); if (!isPlat) throw new Error("Forbidden: platform admin only"); }
    const since = new Date(Date.now() - data.window_days * 86400e3).toISOString();
    const { data: rows, error } = await context.supabase
      .from("ai_usage_events")
      .select("tenant_id, cost_usd")
      .gte("created_at", since)
      .not("tenant_id", "is", null)
      .limit(50000);
    if (error) throw new Error(error.message);

    const agg = new Map<string, { cost: number; count: number }>();
    for (const r of (rows ?? []) as Array<{ tenant_id: string | null; cost_usd: number | null }>) {
      if (!r.tenant_id) continue;
      const a = agg.get(r.tenant_id) ?? { cost: 0, count: 0 };
      a.cost += Number(r.cost_usd ?? 0);
      a.count += 1;
      agg.set(r.tenant_id, a);
    }
    return Array.from(agg.entries())
      .map(([tenant_id, a]) => ({
        tenant_id,
        cost_usd: Number(a.cost.toFixed(4)),
        call_count: a.count,
      }))
      .sort((a, b) => b.cost_usd - a.cost_usd)
      .slice(0, 20);
  });

// ─── 2. Top tools by error rate ─────────────────────────────────────────────
export type ToolErrorRate = {
  tool: string;
  error_rate: number;
  call_count: number;
};

export const getTopToolsByErrorRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ window_hours: z.number().int().min(1).max(168).default(24) }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<ToolErrorRate[]> => {
    { const { data: isPlat } = await context.supabase.rpc("is_platform_admin", { _user_id: context.userId }); if (!isPlat) throw new Error("Forbidden: platform admin only"); }
    const since = new Date(Date.now() - data.window_hours * 3600e3).toISOString();
    const { data: rows, error } = await context.supabase
      .from("ai_usage_events")
      .select("tool_calls")
      .gte("created_at", since)
      .limit(50000);
    if (error) throw new Error(error.message);

    const agg = new Map<string, { errs: number; total: number }>();
    for (const r of (rows ?? []) as Array<{ tool_calls: unknown }>) {
      if (!Array.isArray(r.tool_calls)) continue;
      for (const c of r.tool_calls as Array<{ tool?: string; status?: string }>) {
        if (!c?.tool) continue;
        const a = agg.get(c.tool) ?? { errs: 0, total: 0 };
        a.total += 1;
        if (c.status === "error") a.errs += 1;
        agg.set(c.tool, a);
      }
    }
    return Array.from(agg.entries())
      .map(([tool, a]) => ({
        tool,
        error_rate: a.total === 0 ? 0 : Number((a.errs / a.total).toFixed(4)),
        call_count: a.total,
      }))
      .filter((r) => r.call_count >= 5)
      .sort((a, b) => b.error_rate - a.error_rate)
      .slice(0, 20);
  });

// ─── 3. Slowest tools by p95 ────────────────────────────────────────────────
export type ToolP95 = {
  tool: string;
  p95_ms: number;
  call_count: number;
};

export const getSlowestToolsByP95 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ window_hours: z.number().int().min(1).max(168).default(24) }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<ToolP95[]> => {
    { const { data: isPlat } = await context.supabase.rpc("is_platform_admin", { _user_id: context.userId }); if (!isPlat) throw new Error("Forbidden: platform admin only"); }
    const since = new Date(Date.now() - data.window_hours * 3600e3).toISOString();
    const { data: rows, error } = await context.supabase
      .from("ai_usage_events")
      .select("tool_calls")
      .gte("created_at", since)
      .limit(50000);
    if (error) throw new Error(error.message);

    const lats = new Map<string, number[]>();
    for (const r of (rows ?? []) as Array<{ tool_calls: unknown }>) {
      if (!Array.isArray(r.tool_calls)) continue;
      for (const c of r.tool_calls as Array<{ tool?: string; latency_ms?: number }>) {
        if (!c?.tool) continue;
        const arr = lats.get(c.tool) ?? [];
        arr.push(Number(c.latency_ms ?? 0));
        lats.set(c.tool, arr);
      }
    }
    return Array.from(lats.entries())
      .map(([tool, arr]) => {
        const sorted = [...arr].sort((a, b) => a - b);
        return {
          tool,
          p95_ms: percentile(sorted, 95),
          call_count: sorted.length,
        };
      })
      .filter((r) => r.call_count >= 5)
      .sort((a, b) => b.p95_ms - a.p95_ms)
      .slice(0, 20);
  });
