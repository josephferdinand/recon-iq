import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (value: unknown) => value;
    const chain = {
      middleware: () => chain,
      validator: (fn: (value: unknown) => unknown) => { validate = fn; return chain; },
      handler: (fn: (args: any) => unknown) => (args: { data: unknown; context: unknown }) =>
        fn({ ...args, data: validate(args.data) }),
    };
    return chain;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: () => vi.fn() }));

import { listDataSourcesPage } from "@/lib/data-sources.functions";
import { listSchedulesPage } from "@/lib/connectors.functions";
import { listWatchersPage } from "@/lib/watchers.functions";

const tenantId = "11111111-1111-4111-8111-111111111111";

type Operation = [string, ...unknown[]];
function makeContext(rowsByTable: Record<string, any[]>, failPublicIdColumn = false) {
  const calls: Array<{ table: string; operations: Operation[] }> = [];
  const supabase = {
    from(table: string) {
      const call = { table, operations: [] as Operation[] };
      calls.push(call);
      const allRows = rowsByTable[table] ?? [];
      const query = {
        select: (...args: unknown[]) => { call.operations.push(["select", ...args]); return query; },
        eq: (...args: unknown[]) => { call.operations.push(["eq", ...args]); return query; },
        not: (...args: unknown[]) => { call.operations.push(["not", ...args]); return query; },
        in: (...args: unknown[]) => { call.operations.push(["in", ...args]); return query; },
        or: (...args: unknown[]) => { call.operations.push(["or", ...args]); return query; },
        ilike: (...args: unknown[]) => { call.operations.push(["ilike", ...args]); return query; },
        gte: (...args: unknown[]) => { call.operations.push(["gte", ...args]); return query; },
        lt: (...args: unknown[]) => { call.operations.push(["lt", ...args]); return query; },
        order: (...args: unknown[]) => { call.operations.push(["order", ...args]); return query; },
        range: (from: number, to: number) => {
          call.operations.push(["range", from, to]);
          const missingColumn = failPublicIdColumn && call.operations.some(([name, column]) => name === "ilike" && column === "public_id");
          return Promise.resolve(missingColumn
            ? { data: null, count: null, error: { message: "column public_id does not exist" } }
            : { data: allRows.slice(from, to + 1), count: allRows.length, error: null });
        },
        limit: (limit: number) => {
          call.operations.push(["limit", limit]);
          return Promise.resolve({ data: [], count: null, error: null });
        },
      };
      return query;
    },
  };
  return { context: { supabase }, calls };
}

function id(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function makeRows(table: "workspace_data_sources" | "data_source_schedules" | "data_watchers", size: number) {
  return Array.from({ length: size }, (_, index) => {
    const base = { id: id(index + 1), tenant_id: tenantId, name: `Row ${index + 1}`, updated_at: `2026-09-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z` };
    if (table === "workspace_data_sources") return { ...base, description: null, source_type: "csv", status: "ready", row_count: 1, inferred_schema: null, created_at: base.updated_at };
    if (table === "data_source_schedules") return { ...base, connector_type: "https", cron_expression: "0 * * * *", enabled: true, last_run_at: null, last_status: null, last_rows_ingested: null, config: {}, last_error: null, data_source: null };
    return { ...base, watch_type: "freshness", config: {}, severity: "warning", enabled: true, last_checked_at: null, last_state: null, last_alerted_at: null, data_source_id: id(900_000), data_source: null };
  });
}

const listCases = [
  { name: "sources", run: (context: unknown, data: Record<string, unknown>) => (listDataSourcesPage as any)({ data, context }), table: "workspace_data_sources", base: { page_size: 100 }, expectError: "Data source list is temporarily unavailable. Please try again." },
  { name: "connections", run: (context: unknown, data: Record<string, unknown>) => (listSchedulesPage as any)({ data, context }), table: "data_source_schedules", base: { page_size: 50 }, expectError: "Connections could not be loaded. Please try again." },
  { name: "watchers", run: (context: unknown, data: Record<string, unknown>) => (listWatchersPage as any)({ data, context }), table: "data_watchers", base: { page_size: 100 }, expectError: "Watcher list is temporarily unavailable. Please try again." },
] as const;

describe("ingestion full-collection filters", () => {
  it("applies inclusive UTC dates as gte start and exclusive next-day lt before paging", async () => {
    for (const testCase of listCases) {
      const db = makeContext({ [testCase.table]: makeRows(testCase.table, 2) });
      await testCase.run(db.context, { tenant_id: tenantId, page: testCase.name === "watchers" ? 0 : 1, updated_from: "2026-09-24", updated_through: "2026-09-24" });
      const operations = db.calls.find((call) => call.table === testCase.table)!.operations;
      expect(operations).toContainEqual(["gte", "updated_at", "2026-09-24T00:00:00.000Z"]);
      expect(operations).toContainEqual(["lt", "updated_at", "2026-09-25T00:00:00.000Z"]);
      expect(operations.findIndex(([name]) => name === "gte")).toBeLessThan(operations.findIndex(([name]) => name === "range"));
      expect(operations.find(([name]) => name === "select")?.[2]).toEqual({ count: "exact" });
    }
  });

  it("rejects impossible UTC dates and reversed date ranges before any database call", () => {
    for (const testCase of listCases) {
      const invalid = makeContext({});
      expect(() => testCase.run(invalid.context, { tenant_id: tenantId, ...testCase.base, updated_from: "2026-02-30" })).toThrow();
      expect(() => testCase.run(invalid.context, { tenant_id: tenantId, ...testCase.base, updated_from: "2026-09-25", updated_through: "2026-09-24" })).toThrow();
      expect(invalid.calls).toHaveLength(0);
    }
  });

  it("fails safely if a direct Public ID search reaches a schema without public_id", async () => {
    for (const testCase of listCases) {
      const db = makeContext({ [testCase.table]: [] }, true);
      await expect(testCase.run(db.context, { tenant_id: tenantId, ...testCase.base, public_id_search: "FVI-" })).rejects.toThrow(testCase.expectError);
      expect(db.calls[0].operations).toContainEqual(["ilike", "public_id", "%FVI-%"]);
    }
  });

  it("pages all 400 rows with exact counts and deterministic, non-overlapping ranges", async () => {
    for (const testCase of listCases) {
      const allRows = makeRows(testCase.table, 400);
      const db = makeContext({ [testCase.table]: allRows, data_watcher_events: [] });
      const pageSize = testCase.base.page_size;
      const pages = Math.ceil(allRows.length / pageSize);
      const seen: string[] = [];
      for (let page = 0; page < pages; page++) {
        const result = await testCase.run(db.context, { tenant_id: tenantId, page: testCase.name === "watchers" ? page : page + 1, ...testCase.base });
        expect(testCase.name === "sources" ? result.total : testCase.name === "connections" ? result.count : result.total).toBe(400);
        seen.push(...result.rows.map((row: any) => row.id));
      }
      const ranges = db.calls.filter((call) => call.table === testCase.table).map((call) => call.operations.find(([name]) => name === "range"));
      expect(ranges).toEqual(Array.from({ length: pages }, (_, page) => ["range", page * pageSize, Math.min((page + 1) * pageSize, 400) - 1]));
      expect(seen).toHaveLength(400);
      expect(new Set(seen).size).toBe(400);
    }
  });
});
