/**
 * Phase 3 (7c) — Copilot tool-call monitoring.
 *
 * Reads the `tool_calls` JSONB column on `ai_usage_events` (populated by the
 * Copilot stream + sendMessage paths) and aggregates per-tool counts,
 * latency percentiles, and error rate over the last 24h.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type ToolStat = {
  tool: string;
  count: number;
  errors: number;
  error_rate: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
};

export type CopilotMonitoringResult = {
  window_hours: number;
  per_tool: ToolStat[];
  step_count_distribution: Array<{ steps: number; turns: number }>;
  totals: { turns: number; tool_calls: number; errors: number };
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

export const getCopilotMonitoring = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      window_hours: z.number().int().min(1).max(168).default(24),
    }).parse(d))
  .handler(async ({ data, context }): Promise<CopilotMonitoringResult> => {
    const since = new Date(Date.now() - data.window_hours * 3600e3).toISOString();
    const { data: rows } = await context.supabase
      .from("ai_usage_events")
      .select("tool_calls")
      .eq("tenant_id", data.tenant_id)
      .gte("created_at", since)
      .limit(5000);

    const byTool = new Map<string, { lats: number[]; errs: number }>();
    let totalCalls = 0;
    let totalErrors = 0;
    const stepDist = new Map<number, number>();

    for (const r of (rows ?? []) as Array<{ tool_calls: unknown }>) {
      const calls = Array.isArray(r.tool_calls) ? r.tool_calls : [];
      const stepCount = calls.length;
      stepDist.set(stepCount, (stepDist.get(stepCount) ?? 0) + 1);
      for (const c of calls as Array<{ tool?: string; latency_ms?: number; status?: string }>) {
        if (!c?.tool) continue;
        const bucket = byTool.get(c.tool) ?? { lats: [], errs: 0 };
        bucket.lats.push(Number(c.latency_ms ?? 0));
        if (c.status === "error") { bucket.errs += 1; totalErrors += 1; }
        byTool.set(c.tool, bucket);
        totalCalls += 1;
      }
    }

    const per_tool: ToolStat[] = Array.from(byTool.entries())
      .map(([tool, b]) => {
        const sorted = [...b.lats].sort((a, c) => a - c);
        return {
          tool,
          count: sorted.length,
          errors: b.errs,
          error_rate: sorted.length === 0 ? 0 : Number((b.errs / sorted.length).toFixed(4)),
          p50_ms: percentile(sorted, 50),
          p95_ms: percentile(sorted, 95),
          p99_ms: percentile(sorted, 99),
        };
      })
      .sort((a, b) => b.count - a.count);

    return {
      window_hours: data.window_hours,
      per_tool,
      step_count_distribution: Array.from(stepDist.entries())
        .map(([steps, turns]) => ({ steps, turns }))
        .sort((a, b) => a.steps - b.steps),
      totals: { turns: (rows ?? []).length, tool_calls: totalCalls, errors: totalErrors },
    };
  });
