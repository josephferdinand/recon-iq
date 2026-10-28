import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (value: unknown) => value;
    const chain = {
      middleware: () => chain,
      validator: (fn: (value: unknown) => unknown) => { validate = fn; return chain; },
      handler: (fn: (args: unknown) => unknown) => (args: { data: unknown; context: unknown }) => fn({ ...args, data: validate(args.data) }),
    };
    return chain;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: () => vi.fn() }));

import { getReconRunDetail, listReconDefinitionRuns } from "@/lib/recon-run-detail.functions";

const tenant = "11111111-1111-4111-8111-111111111111";
const definition = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";

function database(results: Record<string, { data: unknown; count?: number | null; error?: unknown }>) {
  const calls: Record<string, Array<[string, ...unknown[]]>> = {};
  const seen: Record<string, number> = {};
  const supabase = { from: (table: string) => {
    const instance = seen[table] ?? 0;
    seen[table] = instance + 1;
    const result = instance === 0 ? results[table] : results[`${table}_completed`] ?? results[table];
    const operations = calls[table] ??= [];
    const query = {
      select: (...args: unknown[]) => { operations.push(["select", ...args]); return query; },
      eq: (...args: unknown[]) => { operations.push(["eq", ...args]); return query; },
      gte: (...args: unknown[]) => { operations.push(["gte", ...args]); return query; },
      order: (...args: unknown[]) => { operations.push(["order", ...args]); return query; },
      range: (...args: unknown[]) => { operations.push(["range", ...args]); return Promise.resolve(result); },
      limit: (...args: unknown[]) => { operations.push(["limit", ...args]); return Promise.resolve(result); },
      maybeSingle: () => { operations.push(["maybeSingle"]); return Promise.resolve(result); },
    };
    return query;
  }, rpc: (name: string, args: unknown) => {
    (calls.rpc ??= []).push([name, args]);
    return Promise.resolve(results[name] ?? { data: null, error: null });
  } };
  return { context: { supabase }, calls };
}

afterEach(() => vi.useRealTimers());

describe("processed reconciliation reads", () => {
  it("bounds a definition's 90-day history by tenant, definition, date and page", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-09-23T12:00:00Z"));
    const db = database({
      recon_runs: { data: [{ id: runId }], count: 121 },
      recon_runs_completed: { data: [{ id: runId }], count: 24 },
    });
    const result = await (listReconDefinitionRuns as any)({ data: { tenant_id: tenant, definition_id: definition, days: 90, page: 2 }, context: db.context });
    expect(result).toEqual({ rows: [{ id: runId, matched_input_memberships: null }], count: 121, completedCount: 24, completedRuns: [{ id: runId, matched_input_memberships: null }], pageSize: 50 });
    expect(db.calls.recon_runs).toContainEqual(["eq", "tenant_id", tenant]);
    expect(db.calls.recon_runs).toContainEqual(["eq", "definition_id", definition]);
    expect(db.calls.recon_runs).toContainEqual(["gte", "started_at", new Date(Date.now() - 90 * 86_400_000).toISOString()]);
    expect(db.calls.recon_runs).toContainEqual(["range", 100, 149]);
    expect(db.calls.recon_runs).toContainEqual(["order", "started_at", { ascending: false }]);
    expect(db.calls.recon_runs).toContainEqual(["order", "id", { ascending: true }]);
    expect(db.calls.recon_runs).toContainEqual(["eq", "status", "completed"]);
    expect(db.calls.recon_runs).toContainEqual(["limit", 5]);
  });

  it("keeps exact counts while paging a 400-run history with a stable id tie-break", async () => {
    const rows = Array.from({ length: 50 }, (_, index) => ({ id: `${index}` }));
    const db = database({
      recon_runs: { data: rows, count: 400 },
      recon_runs_completed: { data: rows.slice(0, 5), count: 400 },
    });
    const result = await (listReconDefinitionRuns as any)({
      data: { tenant_id: tenant, definition_id: definition, days: 90, page: 7 },
      context: db.context,
    });

    expect(result.count).toBe(400);
    expect(result.rows).toHaveLength(50);
    expect(db.calls.recon_runs).toContainEqual(["range", 350, 399]);
    expect(db.calls.recon_runs).toContainEqual(["order", "started_at", { ascending: false }]);
    expect(db.calls.recon_runs).toContainEqual(["order", "id", { ascending: true }]);
  });

  it("rejects invalid period/page before querying and returns a safe read error", async () => {
    const db = database({ recon_runs: { data: null, error: { message: "SQL PRIVATE DETAIL" } } });
    expect(() => (listReconDefinitionRuns as any)({ data: { tenant_id: tenant, definition_id: definition, days: 2, page: 0 }, context: db.context })).toThrow();
    expect(() => (listReconDefinitionRuns as any)({ data: { tenant_id: tenant, definition_id: definition, days: 7, page: -1 }, context: db.context })).toThrow();
    expect(db.calls.recon_runs).toBeUndefined();
    await expect((listReconDefinitionRuns as any)({ data: { tenant_id: tenant, definition_id: definition, days: 7, page: 0 }, context: db.context })).rejects.toThrow("Run history is unavailable. Please try again.");
  });

  it("reads the exact run through full-run counts and deterministic grouped result paging", async () => {
    const db = database({
      recon_runs: { data: { id: runId } },
      get_recon_run_result_page: { data: { rows: [{ kind: "exception", id: "missing:shared-key", exception_items: [{ id: "A-id", public_case_id: "FVI-EXC-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }, { id: "B-id", public_case_id: "FVI-EXC-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" }] }], parent_count: 51, page: 1, page_size: 50, has_next: false } },
      get_recon_run_result_status_counts: { data: { match_groups: 4, exception_items: 8, exception_buckets: { missing: 2 } } },
    });
    const result = await (getReconRunDetail as any)({ data: { tenant_id: tenant, run_id: runId, page: 1, status: "missing" }, context: db.context });
    expect(result.parentCount).toBe(51);
    expect(result.hasNext).toBe(false);
    expect(result.results[0].exception_items).toHaveLength(2);
    expect(result.results[0].exception_items[0].public_case_id).toBe("FVI-EXC-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(result.statusCounts.exception_items).toBe(8);
    expect(db.calls.recon_runs).toContainEqual(["eq", "tenant_id", tenant]);
    expect(db.calls.recon_runs).toContainEqual(["eq", "id", runId]);
    expect(db.calls.rpc).toContainEqual(["get_recon_run_result_page", { _tenant_id: tenant, _run_id: runId, _page: 1, _status: "missing" }]);
    expect(db.calls.rpc).toContainEqual(["get_recon_run_result_status_counts", { _tenant_id: tenant, _run_id: runId }]);
  });

  it("returns no detail and makes no child reads when run is absent", async () => {
    const db = database({ recon_runs: { data: null } });
    await expect((getReconRunDetail as any)({ data: { tenant_id: tenant, run_id: runId, page: 0 }, context: db.context })).resolves.toBeNull();
    expect(db.calls.rpc).toBeUndefined();
  });

  it("returns an empty history page without implying that any run was processed", async () => {
    const db = database({ recon_runs: { data: null, count: 0 } });
    await expect((listReconDefinitionRuns as any)({ data: { tenant_id: tenant, definition_id: definition, days: 1, page: 0 }, context: db.context }))
      .resolves.toEqual({ rows: [], count: 0, completedCount: 0, completedRuns: [], pageSize: 50 });
  });

  it("does not turn a missing exact run-history count into a false zero", async () => {
    const db = database({
      recon_runs: { data: [], count: null },
      recon_runs_completed: { data: [], count: 0 },
    });
    await expect((listReconDefinitionRuns as any)({ data: { tenant_id: tenant, definition_id: definition, days: 7, page: 0 }, context: db.context }))
      .rejects.toThrow("Run history is unavailable. Please try again.");
  });

  it("surfaces a safe message when the exact-run result page read fails", async () => {
    const db = database({
      recon_runs: { data: { id: runId } },
      get_recon_run_result_page: { data: null, error: { message: "SQL PRIVATE DETAIL" } },
    });
    await expect((getReconRunDetail as any)({ data: { tenant_id: tenant, run_id: runId, page: 0 }, context: db.context })).rejects.toThrow("Processed records are unavailable. Please try again.");
  });
});
