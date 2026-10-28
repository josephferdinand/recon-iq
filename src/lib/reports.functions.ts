import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type DayKey = string;
function dayKey(d: Date) { return d.toISOString().slice(0, 10); }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0,0,0,0); return d; }

export const reportsOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    days: z.number().int().min(7).max(180).default(30),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const since = daysAgo(data.days).toISOString();

    const [runsR, excR, matchR] = await Promise.all([
      context.supabase.from("recon_runs")
        .select("id, definition_id, started_at, completed_at, matched_count, exception_count, status, definition:recon_definitions(name)")
        .eq("tenant_id", data.tenant_id).gte("started_at", since)
        .order("started_at", { ascending: true }),
      context.supabase.from("recon_exceptions")
        .select("id, severity, lifecycle_state, priority, created_at, resolved_at, run_id")
        .eq("tenant_id", data.tenant_id).gte("created_at", since),
      context.supabase.from("recon_matches")
        .select("id, created_at").eq("tenant_id", data.tenant_id).gte("created_at", since),
    ]);

    const runs = runsR.data ?? [];
    const exceptions = excR.data ?? [];
    const matches = matchR.data ?? [];

    // Match rate trend per day
    const byDay: Record<DayKey, { matched: number; exceptions: number; runs: number }> = {};
    for (let i = 0; i <= data.days; i++) {
      const k = dayKey(daysAgo(data.days - i));
      byDay[k] = { matched: 0, exceptions: 0, runs: 0 };
    }
    for (const r of runs) {
      const k = (r.started_at ?? "").slice(0, 10);
      if (byDay[k]) {
        byDay[k].matched += r.matched_count ?? 0;
        byDay[k].exceptions += r.exception_count ?? 0;
        byDay[k].runs += 1;
      }
    }
    const trend = Object.entries(byDay).map(([day, v]) => {
      const total = v.matched + v.exceptions;
      return {
        day,
        matched: v.matched,
        exceptions: v.exceptions,
        runs: v.runs,
        match_rate: total > 0 ? Math.round((v.matched / total) * 1000) / 10 : null,
      };
    });

    // Aging buckets (open breaks)
    const open = exceptions.filter((e: any) => !["resolved","written_off"].includes(e.lifecycle_state) && e.status !== "resolved" && e.status !== "wont_fix");
    const now = Date.now();
    const buckets = { "0-1d": 0, "1-3d": 0, "3-7d": 0, "7-14d": 0, ">14d": 0 } as Record<string, number>;
    for (const e of open) {
      const ageH = (now - new Date(e.created_at).getTime()) / 36e5;
      if (ageH < 24) buckets["0-1d"]++;
      else if (ageH < 72) buckets["1-3d"]++;
      else if (ageH < 168) buckets["3-7d"]++;
      else if (ageH < 336) buckets["7-14d"]++;
      else buckets[">14d"]++;
    }
    const aging = Object.entries(buckets).map(([bucket, count]) => ({ bucket, count }));

    // MTTR by priority (resolved within window)
    const resolved = exceptions.filter((e: any) => e.resolved_at);
    const mttrByPriority: Record<string, { sum: number; n: number }> = {};
    for (const e of resolved) {
      const hours = (new Date(e.resolved_at!).getTime() - new Date(e.created_at).getTime()) / 36e5;
      const p = e.priority ?? "P3";
      if (!mttrByPriority[p]) mttrByPriority[p] = { sum: 0, n: 0 };
      mttrByPriority[p].sum += hours;
      mttrByPriority[p].n += 1;
    }
    const mttr = ["P1","P2","P3","P4"].map((p) => ({
      priority: p,
      hours: mttrByPriority[p] && mttrByPriority[p].n > 0
        ? Math.round((mttrByPriority[p].sum / mttrByPriority[p].n) * 10) / 10
        : 0,
      count: mttrByPriority[p]?.n ?? 0,
    }));

    // Severity distribution
    const sevCounts: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const e of exceptions) sevCounts[e.severity ?? "medium"] = (sevCounts[e.severity ?? "medium"] ?? 0) + 1;
    const severity = Object.entries(sevCounts).map(([name, value]) => ({ name, value }));

    // Top recons by exception volume
    const byRecon: Record<string, { name: string; matched: number; exceptions: number }> = {};
    for (const r of runs) {
      const name = (r as any).definition?.name ?? "Unknown";
      const k = name;
      if (!byRecon[k]) byRecon[k] = { name, matched: 0, exceptions: 0 };
      byRecon[k].matched += r.matched_count ?? 0;
      byRecon[k].exceptions += r.exception_count ?? 0;
    }
    const topRecons = Object.values(byRecon)
      .sort((a, b) => b.exceptions - a.exceptions).slice(0, 8);

    // SLA: open breaks past due_date
    const overdueR = await context.supabase.from("recon_exceptions")
      .select("id, due_date, priority")
      .eq("tenant_id", data.tenant_id)
      .not("due_date", "is", null)
      .lt("due_date", new Date().toISOString())
      .not("lifecycle_state", "in", "(resolved,written_off)");
    const overdue = overdueR.data?.length ?? 0;

    const totalMatched = matches.length;
    const totalExceptions = exceptions.length;
    const overallMatchRate = totalMatched + totalExceptions > 0
      ? Math.round((totalMatched / (totalMatched + totalExceptions)) * 1000) / 10 : 0;

    return {
      window_days: data.days,
      kpis: {
        runs: runs.length,
        matched: totalMatched,
        exceptions: totalExceptions,
        open_breaks: open.length,
        overdue,
        match_rate_pct: overallMatchRate,
      },
      trend,
      aging,
      mttr,
      severity,
      top_recons: topRecons,
    };
  });
