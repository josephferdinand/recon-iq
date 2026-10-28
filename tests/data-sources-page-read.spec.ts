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

import { getDataSource, listDataSourcesPage } from "@/lib/data-sources.functions";

const tenantId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";

type QueryResult = { data: any; count?: number | null; error?: unknown };

function makeContext(sourceResult: QueryResult, uploadResult: QueryResult = { data: [] }) {
  const calls: Array<{ table: string; operations: Array<[string, ...unknown[]]> }> = [];
  const supabase = {
    from(table: string) {
      const call = { table, operations: [] as Array<[string, ...unknown[]]> };
      calls.push(call);
      const result = table === "workspace_data_sources" ? sourceResult : uploadResult;
      const query = {
        select: (...args: unknown[]) => { call.operations.push(["select", ...args]); return query; },
        eq: (...args: unknown[]) => { call.operations.push(["eq", ...args]); return query; },
        or: (...args: unknown[]) => { call.operations.push(["or", ...args]); return query; },
        order: (...args: unknown[]) => { call.operations.push(["order", ...args]); return query; },
        range: (...args: unknown[]) => { call.operations.push(["range", ...args]); return Promise.resolve(result); },
        limit: (...args: unknown[]) => { call.operations.push(["limit", ...args]); return Promise.resolve(result); },
        maybeSingle: () => { call.operations.push(["maybeSingle"]); return Promise.resolve(result); },
      };
      return query;
    },
  };
  return { context: { supabase }, calls };
}

function sourceRow(id = sourceId) {
  return {
    id,
    name: "Custodian positions",
    description: "Daily positions feed",
    source_type: "csv",
    status: "ready",
    row_count: 28_450,
    inferred_schema: [
      { name: "account_id", inferred_type: "string", nullable: false, sample: "ACCOUNT-SECRET" },
      { name: "amount", inferred_type: "number", nullable: true, sample: "999999.99" },
    ],
    created_at: "2026-09-24T02:00:00.000Z",
    updated_at: "2026-09-24T03:00:00.000Z",
    connection_config: { password: "not-for-ui" },
    sample_rows: [{ account_id: "not-for-ui" }],
    last_error: "private transport detail",
    created_by: "33333333-3333-4333-8333-333333333333",
  };
}

function callList(context: unknown, data: Record<string, unknown>) {
  return (listDataSourcesPage as any)({ data, context });
}

describe("paginated data-source reads", () => {
  it("returns exact tenant-scoped page counts, stable ordering, and sample-free schema metadata", async () => {
    const row = sourceRow();
    const db = makeContext({ data: [row], count: 37 });

    const result = await callList(db.context, { tenant_id: tenantId });

    expect(result).toMatchObject({ total: 37, page: 1, page_size: 25, total_pages: 2 });
    expect(result.rows).toEqual([{
      id: sourceId,
      name: row.name,
      description: row.description,
      source_type: "csv",
      status: "ready",
      row_count: 28_450,
      inferred_schema: [
        { name: "account_id", inferred_type: "string", nullable: false },
        { name: "amount", inferred_type: "number", nullable: true },
      ],
      created_at: row.created_at,
      updated_at: row.updated_at,
    }]);
    expect(JSON.stringify(result)).not.toContain("ACCOUNT-SECRET");
    expect(JSON.stringify(result)).not.toContain("999999.99");
    const read = db.calls[0];
    expect(read.operations).toContainEqual(["eq", "tenant_id", tenantId]);
    expect(read.operations).toContainEqual(["select", expect.any(String), { count: "exact" }]);
    expect(read.operations).toContainEqual(["range", 0, 24]);
    expect(read.operations).toContainEqual(["order", "updated_at", { ascending: false, nullsFirst: false }]);
    expect(read.operations).toContainEqual(["order", "id", { ascending: false }]);
    expect(read.operations.find(([name]) => name === "select")?.[1]).not.toContain("source_code");
  });

  it("sanitizes name and description search, applies filters, sort allowlist, and exact page offsets", async () => {
    const term = 'USD"),status.eq.archived,(id.eq.secret)%_\\';
    const db = makeContext({ data: [], count: 0 });
    const result = await callList(db.context, {
      tenant_id: tenantId,
      page: 3,
      page_size: 10,
      search: term,
      source_type: "xlsx",
      status: "draft",
      sort_by: "name",
      sort_direction: "asc",
    });
    const read = db.calls[0];
    const searchFilter = read.operations.find(([name]) => name === "or")?.[1] as string;
    const escaped = 'USD\\"),status.eq.archived,(id.eq.secret)\\%\\_\\\\';

    expect(result).toEqual({ rows: [], total: 0, page: 3, page_size: 10, total_pages: 0 });
    expect(searchFilter).toBe(`name.ilike."%${escaped}%",description.ilike."%${escaped}%"`);
    expect(read.operations).toContainEqual(["eq", "source_type", "xlsx"]);
    expect(read.operations).toContainEqual(["eq", "status", "draft"]);
    expect(read.operations).toContainEqual(["order", "name", { ascending: true, nullsFirst: false }]);
    expect(read.operations).toContainEqual(["order", "updated_at", { ascending: false, nullsFirst: false }]);
    expect(read.operations).toContainEqual(["order", "id", { ascending: false }]);
    expect(read.operations).toContainEqual(["range", 20, 29]);
  });

  it("rejects invalid page sizes, statuses, and sort fields before querying", () => {
    const db = makeContext({ data: [], count: 0 });
    expect(() => callList(db.context, { tenant_id: tenantId, page: 0 })).toThrow();
    expect(() => callList(db.context, { tenant_id: tenantId, page_size: 101 })).toThrow();
    expect(() => callList(db.context, { tenant_id: tenantId, status: "paused" })).toThrow();
    expect(() => callList(db.context, { tenant_id: tenantId, sort_by: "created_by" })).toThrow();
    expect(db.calls).toHaveLength(0);
  });

  it("surfaces query errors and missing exact counts instead of returning an empty page", async () => {
    const failed = makeContext({ data: null, count: null, error: { message: "PRIVATE DATABASE DETAIL" } });
    await expect(callList(failed.context, { tenant_id: tenantId }))
      .rejects.toThrow("Data source list is temporarily unavailable. Please try again.");

    const noCount = makeContext({ data: [], count: null });
    await expect(callList(noCount.context, { tenant_id: tenantId }))
      .rejects.toThrow("Data source list is temporarily unavailable. Please try again.");
  });

  it("loads a tenant-scoped detail projection without configuration, samples, raw errors, or creator IDs", async () => {
    const row = sourceRow();
    const db = makeContext({ data: row }, {
      data: [{
        id: "44444444-4444-4444-8444-444444444444",
        filename: "positions.csv",
        mime_type: "text/csv",
        size_bytes: 2048,
        row_count: 28_450,
        columns: [{ name: "account_id", inferred_type: "string", nullable: false, sample: "ACCOUNT-SECRET" }],
        created_at: "2026-09-24T03:00:00.000Z",
        content_sha256: "hash-not-for-view",
        rows: [{ account_id: "ACCOUNT-SECRET" }],
      }],
    });

    const result = await (getDataSource as any)({ data: { id: sourceId, tenant_id: tenantId }, context: db.context });
    const sourceRead = db.calls.find((call) => call.table === "workspace_data_sources")!;
    const uploadsRead = db.calls.find((call) => call.table === "workspace_data_source_uploads")!;

    expect(result).toMatchObject({
      id: sourceId,
      name: row.name,
      status: "ready",
      uploads: [{ filename: "positions.csv", row_count: 28_450, column_count: 1 }],
    });
    expect(result).not.toHaveProperty("connection_config");
    expect(result).not.toHaveProperty("sample_rows");
    expect(result).not.toHaveProperty("last_error");
    expect(result).not.toHaveProperty("created_by");
    expect(JSON.stringify(result)).not.toContain("ACCOUNT-SECRET");
    expect(JSON.stringify(result)).not.toContain("hash-not-for-view");
    expect(sourceRead.operations).toContainEqual(["eq", "id", sourceId]);
    expect(sourceRead.operations).toContainEqual(["eq", "tenant_id", tenantId]);
    expect(uploadsRead.operations).toContainEqual(["eq", "data_source_id", sourceId]);
    expect(uploadsRead.operations).toContainEqual(["eq", "tenant_id", tenantId]);
    expect(uploadsRead.operations).toContainEqual(["limit", 50]);
  });

  it("does not treat upload-history failures as a successful empty list", async () => {
    const db = makeContext({ data: sourceRow() }, { data: null, error: { message: "PRIVATE UPLOAD DETAIL" } });
    await expect((getDataSource as any)({ data: { id: sourceId, tenant_id: tenantId }, context: db.context }))
      .rejects.toThrow("Uploaded file history is temporarily unavailable. Please try again.");
  });
});
