import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recordCounts, summarizeExceptionActivity, summarizeRecordMatchRate, utcDashboardWindow } from "@/lib/workspace-dashboard-metrics";
import { z } from "zod";

export const getTenantDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const t = data.tenant_id;
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const { enforceServerFnRateLimit } = await import("@/lib/rate-limit.server");
    await enforceServerFnRateLimit(
      context.supabase,
      `tenant-dashboard:actor:${context.userId}:tenant:${t}`,
      60,
      6,
      { tenant_id: t, user_id: context.userId, event_type: "tenant.dashboard.rate_limited" },
    );
    await enforceServerFnRateLimit(
      context.supabase,
      `tenant-dashboard:tenant:${t}`,
      60,
      30,
      { tenant_id: t, user_id: context.userId, event_type: "tenant.dashboard.tenant_rate_limited" },
    );

    const budget: DashboardReadBudget = { requests: 0, rows: 0 };
    const [ds, recons, runs, exOpen, exAll, ticketsOpen] = await Promise.all([
      supabase.from("workspace_data_sources").select("id", { count: "exact", head: true }).eq("tenant_id", t),
      supabase.from("recon_definitions").select("id", { count: "exact", head: true }).eq("tenant_id", t),
      fetchAllPages((from, to) => supabase.from("recon_runs").select("id, status, started_at, matched_count, exception_count, total_rows, stats")
        .eq("tenant_id", t).gte("started_at", since).order("started_at", { ascending: false }).order("id", { ascending: true }).range(from, to), budget, 5_000),
      fetchAllPages((from, to) => supabase.from("recon_exceptions").select("id, severity, status, lifecycle_state, created_at")
        .eq("tenant_id", t).eq("status", "open").order("created_at").order("id").range(from, to), budget, 15_000),
      fetchAllPages((from, to) => supabase.from("recon_exceptions").select("id, severity, created_at")
        .eq("tenant_id", t).gte("created_at", since).order("created_at").order("id").range(from, to), budget, 15_000),
      supabase.from("support_tickets").select("id", { count: "exact", head: true })
        .eq("tenant_id", t).in("status", ["open", "in_progress", "waiting_customer"]),
    ]);

    requireDashboardQueries(ds, recons, runs, exOpen, exAll, ticketsOpen);

    const runsList = (runs.data ?? []) as any[];
    const exceptionItems = runsList.reduce((a, r: any) => a + (r.exception_count ?? 0), 0);
    const recordMetrics = summarizeRecordMatchRate(runsList);

    const sevCounts = { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>;
    (exOpen.data ?? []).forEach((e: any) => { if (sevCounts[e.severity] !== undefined) sevCounts[e.severity]++; });

    const byDay: Record<string, number> = {};
    (exAll.data ?? []).forEach((e: any) => {
      const d = (e.created_at as string).slice(0, 10);
      byDay[d] = (byDay[d] ?? 0) + 1;
    });

    return {
      counts: {
        data_sources: ds.count ?? 0,
        recons: recons.count ?? 0,
        open_exceptions: exOpen.data?.length ?? 0,
        open_tickets: ticketsOpen.count ?? 0,
      },
      match_rate_30d: recordMetrics.rate,
      runs_30d: runsList.length,
      matched_records_30d: recordMetrics.matchedRecords,
      total_rows_30d: recordMetrics.totalRows,
      severity_counts: sevCounts,
      exceptions_trend: Object.entries(byDay).sort().map(([d, n]) => ({ date: d, count: n })),
      recent_runs: runsList.slice(0, 8),
      match_rate_available: recordMetrics.complete,
      exception_items_30d: exceptionItems,
    };
  });

// ============================================================================
// Rich workspace analytics — powers the headline Dashboard page.
// ============================================================================

export type DashboardReadBudget = { requests: number; rows: number };

const DASHBOARD_MAX_PAGE_REQUESTS = 40;
const DASHBOARD_MAX_ROWS = 30_000;

export async function fetchAllPages<T>(
  loadPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown | null }>,
  budget: DashboardReadBudget,
  relationMaxRows: number,
) {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    if (budget.requests >= DASHBOARD_MAX_PAGE_REQUESTS) {
      return { data: null, error: new Error("Dashboard request budget exceeded") };
    }
    budget.requests += 1;
    const { data, error } = await loadPage(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const page = data ?? [];
    if (rows.length + page.length > relationMaxRows || budget.rows + page.length > DASHBOARD_MAX_ROWS) {
      return { data: null, error: new Error("Dashboard result exceeds the supported row limit") };
    }
    budget.rows += page.length;
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
}

export function requireDashboardQueries(...results: Array<{ error: unknown | null }>) {
  if (results.some((result) => result.error)) {
    // Keep provider/database details in server logs; the client receives safe, actionable copy.
    console.error("Workspace analytics query failed");
    throw new Error("Workspace analytics are temporarily unavailable. Please try again.");
  }
}

export const getWorkspaceAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; window_days?: number }) =>
    z.object({ tenant_id: z.string().uuid(), window_days: z.number().int().min(7).max(180).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const t = data.tenant_id;
    const W = data.window_days ?? 30;
    const { enforceServerFnRateLimit } = await import("@/lib/rate-limit.server");
    await enforceServerFnRateLimit(
      context.supabase,
      `workspace-dashboard:actor:${context.userId}:tenant:${t}`,
      60,
      6,
      { tenant_id: t, user_id: context.userId, event_type: "workspace.dashboard.rate_limited" },
    );
    await enforceServerFnRateLimit(
      context.supabase,
      `workspace-dashboard:tenant:${t}`,
      60,
      30,
      { tenant_id: t, user_id: context.userId, event_type: "workspace.dashboard.tenant_rate_limited" },
    );
    const window = utcDashboardWindow(new Date(), W);
    const since = window.since;
    const prevSince = window.previousSince;

    const budget: DashboardReadBudget = { requests: 0, rows: 0 };
    const [runs, prevRuns, exAll, exResolved, exOpen, tickets, recons, dsRows, aiUsage, schedules] = await Promise.all([
      fetchAllPages((from, to) => supabase.from("recon_runs")
        .select("id, definition_id, status, started_at, completed_at, matched_count, exception_count, total_rows, stats")
        .eq("tenant_id", t).gte("started_at", since).order("started_at", { ascending: false }).order("id", { ascending: true }).range(from, to), budget, 5_000),
      fetchAllPages((from, to) => supabase.from("recon_runs")
        .select("status, started_at, matched_count, exception_count, total_rows, stats")
        .eq("tenant_id", t).gte("started_at", prevSince).lt("started_at", since).order("started_at", { ascending: false }).order("id", { ascending: true }).range(from, to), budget, 5_000),
      fetchAllPages((from, to) => supabase.from("recon_exceptions")
        .select("id, severity, status, lifecycle_state, created_at, resolved_at, run_id")
        .eq("tenant_id", t).gte("created_at", since).order("created_at").order("id").range(from, to), budget, 15_000),
      fetchAllPages((from, to) => supabase.from("recon_exceptions")
        .select("id, created_at, resolved_at")
        .eq("tenant_id", t).gte("resolved_at", since).order("resolved_at").order("id").range(from, to), budget, 15_000),
      fetchAllPages((from, to) => supabase.from("recon_exceptions")
        .select("id, severity, lifecycle_state, created_at, run_id, assignee, run:recon_runs!inner(definition_id, tenant_id)")
        .eq("tenant_id", t).eq("run.tenant_id", t).eq("status", "open").order("created_at").order("id").range(from, to), budget, 15_000),
      fetchAllPages((from, to) => supabase.from("support_tickets")
        .select("id, status, priority, created_at, resolved_at").eq("tenant_id", t).order("created_at").order("id").range(from, to), budget, 5_000),
      fetchAllPages((from, to) => supabase.from("recon_definitions").select("id, name, recon_type, created_at").eq("tenant_id", t).order("created_at").order("id").range(from, to), budget, 1_000),
      fetchAllPages((from, to) => supabase.from("workspace_data_sources").select("id, source_type, created_at").eq("tenant_id", t).order("created_at").order("id").range(from, to), budget, 5_000),
      fetchAllPages((from, to) => supabase.from("ai_usage_events")
        .select("tokens_in, tokens_out, cost_usd, created_at").eq("tenant_id", t).gte("created_at", since).order("created_at").order("id").range(from, to), budget, 5_000),
      fetchAllPages((from, to) => supabase.from("recon_schedules").select("id, enabled, cron_expression").eq("tenant_id", t).order("id").range(from, to), budget, 1_000),
    ]);

    requireDashboardQueries(runs, prevRuns, exAll, exResolved, exOpen, tickets, recons, dsRows, aiUsage, schedules);

    const runsList = (runs.data ?? []) as any[];
    const prev = (prevRuns.data ?? []) as any[];
    const reconMap: Record<string, any> = Object.fromEntries((recons.data ?? []).map((r: any) => [r.id, r]));

    // Match rate uses matched input records / processed input records from engine stats.
    // Match groups and exception items remain separate run-history counts.
    const recordMetrics = summarizeRecordMatchRate(runsList);
    const prevRecordMetrics = summarizeRecordMatchRate(prev);
    const matchRate = recordMetrics.rate;
    const prevMatchRate = prevRecordMetrics.rate;
    const failures = runsList.filter((r) => r.status === "failed").length;
    const finalizedRuns = runsList.filter((r) => r.status === "completed" || r.status === "failed");
    const completedRuns = finalizedRuns.filter((r) => r.status === "completed").length;
    const successRate = finalizedRuns.length
      ? +(100 * completedRuns / finalizedRuns.length).toFixed(1)
      : null;

    // Throughput & match-rate per day
    const dayKeys = window.dayKeys;
    const perDay: Record<string, { date: string; runs: number; matched: number; unmatched: number; rate: number | null; failed: number; completed: number; metricsComplete: boolean }> = {};
    dayKeys.forEach((d) => (perDay[d] = { date: d, runs: 0, matched: 0, unmatched: 0, rate: null, failed: 0, completed: 0, metricsComplete: true }));
    runsList.forEach((r) => {
      const k = (r.started_at as string).slice(0, 10);
      if (!perDay[k]) return;
      perDay[k].runs += 1;
      if (r.status === "failed") perDay[k].failed += 1;
      if (r.status === "completed") {
        perDay[k].completed += 1;
        const counts = recordCounts(r);
        if (!counts) perDay[k].metricsComplete = false;
        else {
          perDay[k].matched += counts.matchedRecords;
          perDay[k].unmatched += counts.totalRows - counts.matchedRecords;
        }
      }
    });
    const throughput = dayKeys.map((d) => {
      const p = perDay[d];
      const tot = p.matched + p.unmatched;
      return {
        ...p,
        matched: p.completed > 0 && !p.metricsComplete ? null : p.matched,
        unmatched: p.completed > 0 && !p.metricsComplete ? null : p.unmatched,
        rate: p.completed > 0 && p.metricsComplete && tot > 0 ? +(100 * p.matched / tot).toFixed(1) : null,
      };
    });

    // Exceptions opened vs resolved per day
    const exceptionActivity = summarizeExceptionActivity(
      (exAll.data ?? []) as Array<{ created_at: string }>,
      (exResolved.data ?? []) as Array<{ created_at: string; resolved_at: string | null }>,
      dayKeys,
    );
    const exceptionsFlow = exceptionActivity.flow;

    // Severity, lifecycle distributions
    const sevCounts = { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>;
    const lifecycle: Record<string, number> = {};
    (exOpen.data ?? []).forEach((e: any) => {
      if (sevCounts[e.severity] !== undefined) sevCounts[e.severity]++;
      lifecycle[e.lifecycle_state ?? "new"] = (lifecycle[e.lifecycle_state ?? "new"] ?? 0) + 1;
    });

    // Ageing buckets for OPEN exceptions
    const now = new Date(window.asOf).getTime();
    const ageing = { "<1d": 0, "1-3d": 0, "3-7d": 0, "7-30d": 0, ">30d": 0 } as Record<string, number>;
    (exOpen.data ?? []).forEach((e: any) => {
      const age = (now - new Date(e.created_at).getTime()) / 86400_000;
      if (age < 1) ageing["<1d"]++;
      else if (age < 3) ageing["1-3d"]++;
      else if (age < 7) ageing["3-7d"]++;
      else if (age < 30) ageing["7-30d"]++;
      else ageing[">30d"]++;
    });

    // MTTR
    const mttrHrs = exceptionActivity.mttrHours;

    // Top recons by open breaks
    const breaksByDef: Record<string, number> = {};
    (exOpen.data ?? []).forEach((e: any) => {
      const definitionId = e.run?.definition_id;
      if (!definitionId || !reconMap[definitionId]) return;
      breaksByDef[definitionId] = (breaksByDef[definitionId] ?? 0) + 1;
    });
    const topRecons = Object.entries(breaksByDef)
      .map(([id, n]) => ({ id, name: reconMap[id].name, type: reconMap[id].recon_type ?? "—", open: n }))
      .sort((a, b) => b.open - a.open).slice(0, 6);

    // Data source mix
    const dsMix: Record<string, number> = {};
    (dsRows.data ?? []).forEach((d: any) => { dsMix[d.source_type ?? "unknown"] = (dsMix[d.source_type ?? "unknown"] ?? 0) + 1; });

    // Ticket priority distribution + open
    const openTickets = (tickets.data ?? []).filter((x: any) => !["resolved", "closed"].includes(x.status));
    const ticketsByPriority: Record<string, number> = { urgent: 0, high: 0, normal: 0, low: 0 };
    openTickets.forEach((x: any) => { ticketsByPriority[x.priority ?? "normal"] = (ticketsByPriority[x.priority ?? "normal"] ?? 0) + 1; });

    // AI usage
    const aiTokensIn = (aiUsage.data ?? []).reduce((a: number, e: any) => a + (e.tokens_in ?? 0), 0);
    const aiTokensOut = (aiUsage.data ?? []).reduce((a: number, e: any) => a + (e.tokens_out ?? 0), 0);
    const aiCost = +(aiUsage.data ?? []).reduce((a: number, e: any) => a + Number(e.cost_usd ?? 0), 0).toFixed(2);
    const aiByDay: Record<string, { date: string; cost: number; tokens: number }> = {};
    dayKeys.forEach((d) => (aiByDay[d] = { date: d, cost: 0, tokens: 0 }));
    (aiUsage.data ?? []).forEach((e: any) => {
      const k = (e.created_at as string).slice(0, 10);
      if (!aiByDay[k]) return;
      aiByDay[k].cost += Number(e.cost_usd ?? 0);
      aiByDay[k].tokens += (e.tokens_in ?? 0) + (e.tokens_out ?? 0);
    });
    const aiSeries = dayKeys.map((d) => ({ ...aiByDay[d], cost: +aiByDay[d].cost.toFixed(2) }));

    // Headline KPIs + deltas
    const kpis = {
      match_rate: { value: matchRate, delta: matchRate !== null && prevMatchRate !== null ? +(matchRate - prevMatchRate).toFixed(1) : null },
      runs: { value: runsList.length, delta: runsList.length - prev.length },
      open_exceptions: { value: (exOpen.data ?? []).length, delta: 0 },
      mttr_hours: { value: mttrHrs, delta: 0 },
      open_tickets: { value: openTickets.length, delta: 0 },
      success_rate: { value: successRate, delta: successRate === null ? null : 0 },
      data_sources: { value: (dsRows.data ?? []).length, delta: 0 },
      schedules_active: { value: (schedules.data ?? []).filter((s: any) => s.enabled).length, delta: 0 },
    };

    return {
      window_days: W,
      as_of: window.asOf,
      kpis,
      throughput,
      exceptions_flow: exceptionsFlow,
      severity: Object.entries(sevCounts).map(([name, value]) => ({ name, value })),
      lifecycle: Object.entries(lifecycle).map(([name, value]) => ({ name, value })),
      ageing: Object.entries(ageing).map(([name, value]) => ({ name, value })),
      top_recons: topRecons,
      ds_mix: Object.entries(dsMix).map(([name, value]) => ({ name, value })),
      tickets_by_priority: Object.entries(ticketsByPriority).map(([name, value]) => ({ name, value })),
      ai: { tokens_in: aiTokensIn, tokens_out: aiTokensOut, cost_usd: aiCost, series: aiSeries },
      recent_runs: runsList.slice(0, 8).map((r) => {
        const counts = r.status === "completed" ? recordCounts(r) : null;
        return {
          ...r,
          recon_name: reconMap[r.definition_id]?.name ?? "—",
          record_metrics_available: counts !== null,
          matched_records: counts?.matchedRecords ?? null,
          record_total: counts?.totalRows ?? null,
          record_match_rate: counts ? +(100 * counts.matchedRecords / counts.totalRows).toFixed(1) : null,
        };
      }),
      totals: {
        matched_records: recordMetrics.matchedRecords,
        total_rows: recordMetrics.totalRows,
        exception_items: runsList.reduce((sum, r) => sum + (r.exception_count ?? 0), 0),
        record_metrics_available: recordMetrics.complete,
        failures,
      },
    };
  });
