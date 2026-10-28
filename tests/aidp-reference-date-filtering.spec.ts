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
vi.mock("@/lib/ai-metering.server", () => ({ checkBudget: vi.fn(), effectiveAiPolicy: vi.fn(), recordUsage: vi.fn() }));
vi.mock("@/lib/aidp-predict.server", () => ({
  resolveModelVersion: vi.fn(), callPredictionModel: vi.fn(), coerceValueColumns: vi.fn(), decideForField: vi.fn(),
}));

import { listAidpDocuments, listAidpTemplates } from "@/lib/aidp.functions";
import { listReferenceTablesPage } from "@/lib/reference-data.functions";

const tenantId = "11111111-1111-4111-8111-111111111111";

function makeContext(tableRows: unknown[], count = 400, finalError?: unknown) {
  const calls: Array<{ table: string; operations: Array<[string, ...unknown[]]> }> = [];
  const supabase = {
    from(table: string) {
      const call = { table, operations: [] as Array<[string, ...unknown[]]> };
      calls.push(call);
      const query = {
        select: (...args: unknown[]) => { call.operations.push(["select", ...args]); return query; },
        eq: (...args: unknown[]) => { call.operations.push(["eq", ...args]); return query; },
        ilike: (...args: unknown[]) => { call.operations.push(["ilike", ...args]); return query; },
        gte: (...args: unknown[]) => { call.operations.push(["gte", ...args]); return query; },
        lt: (...args: unknown[]) => { call.operations.push(["lt", ...args]); return query; },
        not: (...args: unknown[]) => { call.operations.push(["not", ...args]); return query; },
        filter: (...args: unknown[]) => { call.operations.push(["filter", ...args]); return query; },
        or: (...args: unknown[]) => { call.operations.push(["or", ...args]); return query; },
        order: (...args: unknown[]) => { call.operations.push(["order", ...args]); return query; },
        range: async (...args: unknown[]) => {
          call.operations.push(["range", ...args]);
          return { data: tableRows, error: finalError ?? null, count };
        },
      };
      return query;
    },
  };
  return { context: { supabase }, calls };
}

function read(fn: unknown, data: Record<string, unknown>, context: unknown) {
  return (fn as any)({ data: { tenant_id: tenantId, ...data }, context });
}

describe("authorized full-collection date and Public ID filters", () => {
  it("filters AIDP documents and templates by UTC inclusive-start/exclusive-next-day before count and page", async () => {
    for (const [fn, table, dateField] of [
      [listAidpDocuments, "aidp_documents", "created_at"],
      [listAidpTemplates, "aidp_templates", "created_at"],
    ] as const) {
      const db = makeContext([{ id: "row-300" }]);
      const result = await read(fn, {
        page: 3, page_size: 100, created_from: "2026-09-01", created_to: "2026-09-30",
      }, db.context);
      const operations = db.calls.find((call) => call.table === table)!.operations;
      const fromIndex = operations.findIndex(([name]) => name === "gte");
      const toIndex = operations.findIndex(([name]) => name === "lt");
      const rangeIndex = operations.findIndex(([name]) => name === "range");
      expect(result).toMatchObject({ total: 400, rows: [{ id: "row-300" }] });
      expect(operations).toContainEqual(["gte", dateField, "2026-09-01T00:00:00.000Z"]);
      expect(operations).toContainEqual(["lt", dateField, "2026-10-01T00:00:00.000Z"]);
      expect(operations.find(([name]) => name === "select")?.[2]).toMatchObject({ count: "exact" });
      expect(operations).toContainEqual(["range", 300, 399]);
      expect(fromIndex).toBeLessThan(rangeIndex);
      expect(toIndex).toBeLessThan(rangeIndex);
    }
  });

  it("filters Reference Data by UTC updated-date boundaries and returns exact 400-row paging", async () => {
    const db = makeContext([{ id: "row-300" }]);
    const result = await read(listReferenceTablesPage, {
      page: 3, page_size: 100, updated_from: "2026-02-01", updated_to: "2026-02-28",
    }, db.context);
    const operations = db.calls[0].operations;
    expect(result).toMatchObject({ total: 400, page: 3, page_size: 100, rows: [{ id: "row-300" }] });
    expect(operations).toContainEqual(["gte", "updated_at", "2026-02-01T00:00:00.000Z"]);
    expect(operations).toContainEqual(["lt", "updated_at", "2026-03-01T00:00:00.000Z"]);
    expect(operations).toContainEqual(["range", 300, 399]);
    expect(operations.findIndex(([name]) => name === "gte")).toBeLessThan(operations.findIndex(([name]) => name === "range"));
    expect(operations.findIndex(([name]) => name === "lt")).toBeLessThan(operations.findIndex(([name]) => name === "range"));
  });

  it("rejects impossible and reversed UTC date ranges before querying", async () => {
    const db = makeContext([]);
    expect(() => read(listAidpDocuments, { created_from: "2026-02-30" }, db.context)).toThrow();
    expect(() => read(listAidpTemplates, { created_from: "2026-09-30", created_to: "2026-09-01" }, db.context)).toThrow("Created-to date must be on or after created-from date");
    expect(() => read(listReferenceTablesPage, { updated_to: "2026-13-01" }, db.context)).toThrow();
    expect(() => read(listReferenceTablesPage, { updated_from: "2026-10-01", updated_to: "2026-09-01" }, db.context)).toThrow("Updated-to date must be on or after updated-from date");
    expect(db.calls).toHaveLength(0);
  });

  it("applies Public ID as a server predicate and fails safely when the column is unavailable", async () => {
    const db = makeContext([{ id: "row" }]);
    await read(listAidpDocuments, { public_id_search: "FVI-AIDPD-AB12" }, db.context);
    expect(db.calls[0].operations).toContainEqual(["ilike", "public_id", "%FVI-AIDPD-AB12%"]);

    const oldSchema = makeContext([], 0, { code: "42703", message: "column aidp_documents.public_id does not exist" });
    await expect(read(listAidpDocuments, { public_id_search: "FVI-AIDPD-AB12" }, oldSchema.context)).rejects.toThrow("Public ID search is not available on this environment yet");
    const oldReferenceSchema = makeContext([], 0, { code: "PGRST204", message: "public_id not found in schema cache" });
    await expect(read(listReferenceTablesPage, { public_id_search: "FVI-REF-AB12" }, oldReferenceSchema.context)).rejects.toThrow("Public ID search is not available on this environment yet");
  });
});
