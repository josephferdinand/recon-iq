import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fetchAllPages, requireDashboardQueries } from "@/lib/dashboard.functions";
import { summarizeExceptionActivity, summarizeRecordMatchRate, utcDashboardWindow } from "@/lib/workspace-dashboard-metrics";

const server = readFileSync("src/lib/dashboard.functions.ts", "utf8");
const metrics = readFileSync("src/lib/workspace-dashboard-metrics.ts", "utf8");
const component = readFileSync("src/components/workspace-dashboard.tsx", "utf8");

describe("workspace dashboard data contract", () => {
  it("uses engine input-record totals for match rate and keeps groups and exception items separate", () => {
    expect(metrics).toContain("stats?.matched_records");
    expect(metrics).toContain("run.status === \"completed\"");
    expect(server).toContain("counts.totalRows - counts.matchedRecords");
    expect(server).toContain("exception_items:");
    expect(server).not.toContain("matched_count + r.exception_count");
    expect(server).not.toContain("r.unmatched_count");
    expect(metrics).toContain("rate: complete && totalRows > 0 ?");
    expect(component).toContain("Not matched input records");
    expect(component).toContain("exception items");
  });

  it("calculates rate from record grain and excludes incomplete runs from KPI eligibility", () => {
    const result = summarizeRecordMatchRate([
      { status: "completed", matched_count: 3, exception_count: 5, total_rows: 12, stats: { matched_records: 7, total_rows: 12 } },
      { status: "failed", matched_count: 0, exception_count: 0, total_rows: 0, stats: {} },
    ]);
    expect(result).toMatchObject({ matchedRecords: 7, totalRows: 12, complete: true, rate: 58.3 });
    expect(summarizeRecordMatchRate([
      { status: "completed", matched_count: 3, exception_count: 5, total_rows: 12, stats: {} },
    ])).toMatchObject({ complete: false, rate: null });
    expect(summarizeRecordMatchRate([
      { status: "failed", matched_count: 0, exception_count: 0, total_rows: 0, stats: {} },
    ])).toMatchObject({ complete: false, rate: null });
  });

  it("queries existing columns and pages every multi-row dashboard result deterministically", () => {
    expect(server).toContain("definition_id, status, started_at, completed_at, matched_count, exception_count, total_rows, stats");
    expect(server).toContain("recon_type");
    expect(server).toContain("source_type");
    expect(server).toContain("tokens_in, tokens_out, cost_usd, created_at");
    expect(server).toContain("run:recon_runs!inner(definition_id, tenant_id)");
    expect(server).toContain('.eq("tenant_id", t).eq("run.tenant_id", t).eq("status", "open")');
    expect(server).toContain("if (!definitionId || !reconMap[definitionId]) return;");
    expect(server).not.toContain('name: reconMap[id]?.name ?? "(deleted)"');
    expect(server).not.toContain("recon_definition_id, assigned_to");
    expect(server).not.toContain("created_at, kind");
    expect(server).toContain(".order(\"created_at\").order(\"id\").range(from, to)");
    expect(server).toContain(".range(from, to)");
    expect(server).toContain("const DASHBOARD_MAX_PAGE_REQUESTS = 40");
    expect(server).toContain("const DASHBOARD_MAX_ROWS = 30_000");
    expect(server).toContain("budget.requests >= DASHBOARD_MAX_PAGE_REQUESTS");
    expect(server).toContain("budget.rows + page.length > DASHBOARD_MAX_ROWS");
    expect(server).toContain("workspace-dashboard:actor:${context.userId}:tenant:${t}");
    expect(server).toContain("workspace-dashboard:tenant:${t}");
    expect(server).toContain("await import(\"@/lib/rate-limit.server\")");
  });

  it("bounds repeated dashboard work and slows automatic refresh", () => {
    expect(server).toContain("60,\n      6,");
    expect(server).toContain("60,\n      30,");
    expect(component).toContain("refetchInterval: 5 * 60_000");
    expect(component).toContain("staleTime: 4 * 60_000");
    expect(component).toContain("refreshes every 5 minutes");
  });

  it("fails closed when the shared request budget is exhausted", async () => {
    let calls = 0;
    const budget = { requests: 40, rows: 0 };
    const result = await fetchAllPages(async () => {
      calls += 1;
      return { data: [], error: null };
    }, budget, 5_000);

    expect(calls).toBe(0);
    expect(result.data).toBeNull();
    expect(result.error).toEqual(new Error("Dashboard request budget exceeded"));
  });

  it("fails closed before accepting per-relation or shared row overflow", async () => {
    const relationBudget = { requests: 0, rows: 0 };
    const relationOverflow = await fetchAllPages(async () => ({ data: [1, 2], error: null }), relationBudget, 1);
    expect(relationOverflow.data).toBeNull();
    expect(relationOverflow.error).toEqual(new Error("Dashboard result exceeds the supported row limit"));
    expect(relationBudget).toEqual({ requests: 1, rows: 0 });

    const sharedBudget = { requests: 0, rows: 29_999 };
    const sharedOverflow = await fetchAllPages(async () => ({ data: [1, 2], error: null }), sharedBudget, 5_000);
    expect(sharedOverflow.data).toBeNull();
    expect(sharedOverflow.error).toEqual(new Error("Dashboard result exceeds the supported row limit"));
    expect(sharedBudget).toEqual({ requests: 1, rows: 29_999 });
  });

  it("does not expose provider details when a backing query fails", () => {
    const original = console.error;
    console.error = () => undefined;
    try {
      expect(() => requireDashboardQueries({ error: new Error("provider secret") }))
        .toThrow("Workspace analytics are temporarily unavailable. Please try again.");
    } finally {
      console.error = original;
    }
  });

  it("fails the dashboard query when any backing read fails", () => {
    expect(server).toContain("requireDashboardQueries(runs, prevRuns, exAll, exResolved, exOpen, tickets, recons, dsRows, aiUsage, schedules)");
    expect(server).toContain("Workspace analytics are temporarily unavailable. Please try again.");
  });

  it("shows a safe unavailable state with a retry instead of zero-valued KPIs", () => {
    expect(component).toContain("if (q.isError)");
    expect(component).toContain("Dashboard data could not be loaded. Check your connection and try again.");
    expect(component).toContain("onClick={() => q.refetch()}");
  });

  it("uses the same UTC calendar-day window for cards and chart dates", () => {
    const window = utcDashboardWindow(new Date("2026-09-25T15:45:00Z"), 7);
    expect(window.since).toBe("2026-09-19T00:00:00.000Z");
    expect(window.previousSince).toBe("2026-09-12T00:00:00.000Z");
    expect(window.dayKeys).toEqual(["2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"]);
    expect(server).toContain("const dayKeys = window.dayKeys;");
  });

  it("counts cases resolved in the window even when opened earlier, and never calls absent MTTR zero", () => {
    const result = summarizeExceptionActivity(
      [{ created_at: "2026-09-24T08:00:00Z" }],
      [{ created_at: "2026-08-30T00:00:00Z", resolved_at: "2026-09-24T12:00:00Z" }],
      ["2026-09-24"],
    );
    expect(result.flow).toEqual([{ date: "2026-09-24", opened: 1, resolved: 1 }]);
    expect(result.mttrHours).toBeGreaterThan(0);
    expect(summarizeExceptionActivity([], [], ["2026-09-24"]).mttrHours).toBeNull();
    expect(component).toContain("MTTR unavailable · no resolved cases in period");
  });

  it("uses a separate percent axis for rate and truthful empty-chart states", () => {
    expect(component).toContain("<ComposedChart data={d.throughput}");
    expect(component).toContain('<YAxis yAxisId="rate" orientation="right" domain={[0, 100]}');
    expect(component).toContain("No completed runs with valid input-record totals in this period.");
    expect(component).toContain("No open exceptions at this snapshot.");
    expect(component).not.toContain("1,247 matches / 3 breaks");
  });
});
