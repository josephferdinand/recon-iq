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

import { listReconsPage } from "@/lib/recons.functions";

const tenantId = "11111111-1111-4111-8111-111111111111";

type QueryResult = { data: any; count?: number | null; error?: unknown };

function makeContext(definitions: QueryResult, runs: Record<string, QueryResult> = {}) {
  const calls: Array<{ table: string; operations: Array<[string, ...unknown[]]> }> = [];
  let inFlightRuns = 0;
  let maxInFlightRuns = 0;

  const supabase = {
    from(table: string) {
      const call = { table, operations: [] as Array<[string, ...unknown[]]> };
      calls.push(call);
      let definitionId = "";
      const query = {
        select: (...args: unknown[]) => { call.operations.push(["select", ...args]); return query; },
        eq: (...args: unknown[]) => {
          call.operations.push(["eq", ...args]);
          if (args[0] === "definition_id") definitionId = String(args[1]);
          return query;
        },
        gte: (...args: unknown[]) => { call.operations.push(["gte", ...args]); return query; },
        lt: (...args: unknown[]) => { call.operations.push(["lt", ...args]); return query; },
        or: (...args: unknown[]) => { call.operations.push(["or", ...args]); return query; },
        order: (...args: unknown[]) => { call.operations.push(["order", ...args]); return query; },
        range: (...args: unknown[]) => {
          call.operations.push(["range", ...args]);
          const rangeFilters = call.operations.filter(([name]) => name === "gte" || name === "lt");
          if (rangeFilters.length > 0 && Array.isArray(definitions.data)) {
            const filtered = definitions.data.filter((row) => rangeFilters.every(([op, field, value]) =>
              op === "gte" ? String(row[field as string] ?? "") >= String(value)
                : String(row[field as string] ?? "") < String(value)));
            const sortOperations = call.operations.filter(([name]) => name === "order");
            filtered.sort((left, right) => {
              for (const [, field, order] of sortOperations) {
                const { ascending } = order as { ascending?: boolean };
                const a = String(left[field as string] ?? "");
                const b = String(right[field as string] ?? "");
                const comparison = a.localeCompare(b);
                if (comparison) return ascending ? comparison : -comparison;
              }
              return 0;
            });
            const [from, to] = args as [number, number];
            return Promise.resolve({ ...definitions, data: filtered.slice(from, to + 1), count: filtered.length });
          }
          return Promise.resolve(definitions);
        },
        limit: async (...args: unknown[]) => {
          call.operations.push(["limit", ...args]);
          inFlightRuns++;
          maxInFlightRuns = Math.max(maxInFlightRuns, inFlightRuns);
          await new Promise((resolve) => setTimeout(resolve, 2));
          inFlightRuns--;
          return runs[definitionId] ?? { data: [] };
        },
      };
      return query;
    },
  };

  return {
    context: { supabase },
    calls,
    get maxInFlightRuns() { return maxInFlightRuns; },
  };
}

function definition(id: string, updatedAt = "2026-09-24T10:00:00.000Z") {
  return {
    id,
    recon_code: `REC-${id}`,
    name: `Reconciliation ${id}`,
    description: "Description",
    recon_type: "two_sided",
    status: "active",
    sides: [],
    rules: [],
    updated_at: updatedAt,
  };
}

function callPage(context: unknown, data: Record<string, unknown>) {
  return (listReconsPage as any)({ data, context });
}

describe("paginated reconciliation definition reads", () => {
  it("returns exact count metadata and stable tenant-scoped pages with latest run state", async () => {
    const definitions = [definition("one"), definition("two", "2026-09-23T10:00:00.000Z")];
    const db = makeContext({ data: definitions, count: 27 }, {
      one: { data: [{ started_at: "2026-09-24T09:00:00.000Z", status: "completed" }] },
      two: { data: [] },
    });

    const result = await callPage(db.context, { tenant_id: tenantId, page: 2 });

    expect(result).toMatchObject({ total: 27, page: 2, page_size: 25, total_pages: 2 });
    expect(result.rows).toEqual([
      { ...definitions[0], last_run_at: "2026-09-24T09:00:00.000Z", last_status: "completed", last_run_available: true },
      { ...definitions[1], last_run_at: null, last_status: null, last_run_available: true },
    ]);
    const definitionRead = db.calls.find((call) => call.table === "recon_definitions")!;
    expect(definitionRead.operations).toContainEqual(["select", expect.any(String), { count: "exact" }]);
    expect(definitionRead.operations).toContainEqual(["eq", "tenant_id", tenantId]);
    expect(definitionRead.operations).toContainEqual(["range", 25, 49]);
    expect(definitionRead.operations).toContainEqual(["order", "updated_at", { ascending: false, nullsFirst: false }]);
    expect(definitionRead.operations).toContainEqual(["order", "id", { ascending: false }]);
    for (const runRead of db.calls.filter((call) => call.table === "recon_runs")) {
      expect(runRead.operations).toContainEqual(["eq", "tenant_id", tenantId]);
      expect(runRead.operations).toContainEqual(["eq", "definition_id", expect.any(String)]);
      expect(runRead.operations).toContainEqual(["order", "started_at", { ascending: false, nullsFirst: false }]);
      expect(runRead.operations).toContainEqual(["limit", 1]);
    }
  });

  it("does not serialize unexpected definition fields into the list response", async () => {
    const unexpected = { ...definition("one"), created_by: "PRIVATE-ACTOR", extension: { secret_ref: "PRIVATE-CONFIG" } };
    const db = makeContext({ data: [unexpected], count: 1 });
    const result = await callPage(db.context, { tenant_id: tenantId });
    expect(result.rows[0]).not.toHaveProperty("created_by");
    expect(result.rows[0]).not.toHaveProperty("extension");
    expect(JSON.stringify(result)).not.toContain("PRIVATE-");
  });

  it("applies validated filters and quotes escaped search text inside the allowed OR fields", async () => {
    const term = 'USD"),status.eq.archived,(id.eq.secret%_\\';
    const db = makeContext({ data: [], count: 0 });
    const result = await callPage(db.context, {
      tenant_id: tenantId,
      search: term,
      status: "active",
      recon_type: "three_sided",
      sort_by: "name",
      sort_direction: "asc",
    });
    const read = db.calls.find((call) => call.table === "recon_definitions")!;
    const filter = read.operations.find(([name]) => name === "or")?.[1] as string;
    const escaped = 'USD\\"),status.eq.archived,(id.eq.secret\\%\\_\\\\';

    expect(result).toEqual({ rows: [], total: 0, page: 1, page_size: 25, total_pages: 0 });
    expect(filter).toBe([
      `name.ilike."%${escaped}%"`,
      `recon_code.ilike."%${escaped}%"`,
      `description.ilike."%${escaped}%"`,
    ].join(","));
    expect(read.operations).toContainEqual(["eq", "status", "active"]);
    expect(read.operations).toContainEqual(["eq", "recon_type", "three_sided"]);
    expect(read.operations).toContainEqual(["order", "name", { ascending: true, nullsFirst: false }]);
    expect(read.operations).toContainEqual(["order", "updated_at", { ascending: false, nullsFirst: false }]);
    expect(read.operations).toContainEqual(["order", "id", { ascending: false }]);
  });

  it("filters 400 definitions by inclusive UTC calendar boundaries before exact count and page", async () => {
    const definitions = Array.from({ length: 400 }, (_, index) => {
      const day = String(Math.floor(index / 40) + 1).padStart(2, "0");
      return definition(`row-${String(index).padStart(3, "0")}`, `2026-05-${day}T12:00:00.000Z`);
    });
    definitions[80].updated_at = "2026-05-03T00:00:00.000Z";
    definitions[159].updated_at = "2026-05-04T23:59:59.999Z";
    definitions[160].updated_at = "2026-05-05T00:00:00.000Z";
    const db = makeContext({ data: definitions, count: definitions.length });

    const firstPage = await callPage(db.context, {
      tenant_id: tenantId, page: 1, page_size: 25,
      updated_from: "2026-05-03", updated_through: "2026-05-04",
    });
    const finalPage = await callPage(db.context, {
      tenant_id: tenantId, page: 4, page_size: 25,
      updated_from: "2026-05-03", updated_through: "2026-05-04",
    });

    expect(firstPage).toMatchObject({ total: 80, page: 1, page_size: 25, total_pages: 4 });
    expect(firstPage.rows.map((row: ReconListPageRow) => row.id)).not.toContain("row-160");
    expect(firstPage.rows.map((row: ReconListPageRow) => row.id)).toContain("row-159");
    expect(finalPage.total).toBe(80);
    expect(finalPage.rows.map((row: ReconListPageRow) => row.id)).toContain("row-080");
    const read = db.calls.find((call) => call.table === "recon_definitions")!;
    expect(read.operations).toContainEqual(["gte", "updated_at", "2026-05-03T00:00:00.000Z"]);
    expect(read.operations).toContainEqual(["lt", "updated_at", "2026-05-05T00:00:00.000Z"]);
    const gteIndex = read.operations.findIndex(([op]) => op === "gte");
    const rangeIndex = read.operations.findIndex(([op]) => op === "range");
    expect(gteIndex).toBeGreaterThan(-1);
    expect(gteIndex).toBeLessThan(rangeIndex);
  });

  it("rejects invalid pages and page sizes before database access", () => {
    const db = makeContext({ data: [], count: 0 });
    expect(() => callPage(db.context, { tenant_id: tenantId, page: 0 })).toThrow();
    expect(() => callPage(db.context, { tenant_id: tenantId, page_size: 101 })).toThrow();
    expect(() => callPage(db.context, { tenant_id: tenantId, sort_by: "created_by" })).toThrow();
    expect(() => callPage(db.context, { tenant_id: tenantId, updated_from: "2026-02-30" })).toThrow();
    expect(() => callPage(db.context, { tenant_id: tenantId, updated_from: "2026-03-10", updated_through: "2026-03-09" })).toThrow();
    expect(db.calls).toHaveLength(0);
  });

  it("fails safely when exact count or the definition read is unavailable", async () => {
    const readFailure = makeContext({ data: null, count: null, error: { message: "PRIVATE DB DETAIL" } });
    await expect(callPage(readFailure.context, { tenant_id: tenantId }))
      .rejects.toThrow("Reconciliation list is temporarily unavailable. Please try again.");
    expect(readFailure.calls.filter((call) => call.table === "recon_runs")).toHaveLength(0);

    const missingCount = makeContext({ data: [], count: null });
    await expect(callPage(missingCount.context, { tenant_id: tenantId }))
      .rejects.toThrow("Reconciliation list is temporarily unavailable. Please try again.");
  });

  it("marks failed latest-run reads unavailable instead of implying that no run exists", async () => {
    const db = makeContext({ data: [definition("one")], count: 1 }, {
      one: { data: null, error: { message: "PRIVATE RUN READ ERROR" } },
    });

    const result = await callPage(db.context, { tenant_id: tenantId });
    expect(result.rows[0]).toMatchObject({ last_run_at: null, last_status: null, last_run_available: false });
  });

  it("caps latest-run query concurrency while preserving input row order", async () => {
    const definitions = Array.from({ length: 8 }, (_, index) => definition(String(index)));
    const runs = Object.fromEntries(definitions.map((row) => [
      row.id,
      { data: [{ started_at: `2026-09-24T10:00:${String(8 - Number(row.id)).padStart(2, "0")}.000Z`, status: "completed" }] },
    ]));
    const db = makeContext({ data: definitions, count: definitions.length }, runs);

    const result = await callPage(db.context, { tenant_id: tenantId, page_size: 8 });
    expect(db.maxInFlightRuns).toBe(5);
    expect(result.rows.map((row: { id: string }) => row.id)).toEqual(definitions.map((row) => row.id));
  });
});
