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

import { listReconDefinitionRuns } from "@/lib/recon-run-detail.functions";

const tenant = "11111111-1111-4111-8111-111111111111";
const definition = "22222222-2222-4222-8222-222222222222";
const since = "2026-09-23T12:00:00.000Z";

function database(results: Array<{ data: unknown[]; count: number }>) {
  const calls: Array<{ table: string; operations: Array<[string, ...unknown[]]> }> = [];
  const supabase = { from: (table: string) => {
    const queryIndex = calls.length;
    const operations: Array<[string, ...unknown[]]> = [];
    calls.push({ table, operations });
    const query = {
      select: (...args: unknown[]) => { operations.push(["select", ...args]); return query; },
      eq: (...args: unknown[]) => { operations.push(["eq", ...args]); return query; },
      gte: (...args: unknown[]) => { operations.push(["gte", ...args]); return query; },
      order: (...args: unknown[]) => { operations.push(["order", ...args]); return query; },
      range: (...args: unknown[]) => { operations.push(["range", ...args]); return Promise.resolve(results[queryIndex]); },
      limit: (...args: unknown[]) => { operations.push(["limit", ...args]); return Promise.resolve(results[queryIndex]); },
    };
    return query;
  } };
  return { context: { supabase }, calls };
}

afterEach(() => vi.useRealTimers());

describe("per-definition run overview reads", () => {
  it("returns exact period totals and five latest completed rows at explicit persisted grains", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-09-24T12:00:00.000Z"));
    const latest = { id: "run-latest", status: "completed", total_rows: 17, matched_count: 2, exception_count: 7, stats: { matched_records: 8 } };
    const latestSummary = { id: "run-latest", status: "completed", total_rows: 17, matched_count: 2, exception_count: 7, matched_input_memberships: 8 };
    const db = database([
      { data: [latest], count: 8 },
      { data: [latest], count: 5 },
    ]);
    const result = await (listReconDefinitionRuns as any)({
      data: { tenant_id: tenant, definition_id: definition, days: 1, page: 0 },
      context: db.context,
    });

    expect(result).toEqual({ rows: [latestSummary], count: 8, completedCount: 5, completedRuns: [latestSummary], pageSize: 50 });
    expect(db.calls).toHaveLength(2);
    for (const call of db.calls) {
      expect(call.table).toBe("recon_runs");
      expect(call.operations).toContainEqual(["eq", "tenant_id", tenant]);
      expect(call.operations).toContainEqual(["eq", "definition_id", definition]);
      expect(call.operations).toContainEqual(["gte", "started_at", since]);
    }
    expect(db.calls[0].operations).toContainEqual(["range", 0, 49]);
    expect(db.calls[1].operations).toContainEqual(["eq", "status", "completed"]);
    expect(db.calls[1].operations).toContainEqual(["limit", 5]);
  });

  it("rejects invalid periods and scopes before any database read", () => {
    const db = database([]);
    expect(() => (listReconDefinitionRuns as any)({ data: { tenant_id: tenant, definition_id: definition, days: 2, page: 0 }, context: db.context })).toThrow();
    expect(() => (listReconDefinitionRuns as any)({ data: { tenant_id: "not-a-tenant", definition_id: definition, days: 7, page: 0 }, context: db.context })).toThrow();
    expect(db.calls).toHaveLength(0);
  });
});
