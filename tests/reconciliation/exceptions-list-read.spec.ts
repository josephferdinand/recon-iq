import { describe, expect, it, vi } from "vitest";

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

import { classifyExceptionMatchIssue, listExceptionPage, listBreaks } from "@/lib/break-manager.functions";

const tenant = "11111111-1111-4111-8111-111111111111";

function database(result: { data: unknown[]; count: number | null; error?: { message: string } | null }, runResult?: { data: { id: string } | null; error?: { message: string } | null }) {
  const operations: Array<[string, ...unknown[]]> = [];
  const query: any = {
    select: (...args: unknown[]) => { operations.push(["select", ...args]); return query; },
    eq: (...args: unknown[]) => { operations.push(["eq", ...args]); return query; },
    is: (...args: unknown[]) => { operations.push(["is", ...args]); return query; },
    or: (...args: unknown[]) => { operations.push(["or", ...args]); return query; },
    order: (...args: unknown[]) => { operations.push(["order", ...args]); return query; },
    range: (...args: unknown[]) => { operations.push(["range", ...args]); return Promise.resolve(result); },
    limit: (...args: unknown[]) => { operations.push(["limit", ...args]); return Promise.resolve(result); },
  };
  const runQuery: any = {
    select: (...args: unknown[]) => { operations.push(["run_select", ...args]); return runQuery; },
    eq: (...args: unknown[]) => { operations.push(["run_eq", ...args]); return runQuery; },
    ilike: (...args: unknown[]) => { operations.push(["run_ilike", ...args]); return runQuery; },
    maybeSingle: async () => runResult ?? { data: null, error: null },
  };
  return { context: { supabase: { from: (table: string) => { operations.push(["from", table]); return table === "recon_runs" ? runQuery : query; } } }, operations };
}

describe("exception inbox server paging", () => {
  it("uses tenant-scoped exact counts, server filters, stable ordering and the requested range", async () => {
    const db = database({ data: [{ id: "internal-only", public_case_id: "FVI-EXC-00000000000000000000000000000041", reason: "Unmatched: no counterpart on side B for key sensitive-value" }], count: 41 });
    const result = await (listExceptionPage as any)({
      data: { tenant_id: tenant, paginate: true, page: 4, page_size: 10, status: "open", severity: "high", lifecycle_state: "unspecified", q: "custodian" },
      context: db.context,
    });

    expect(result).toEqual({ items: [{ id: "internal-only", public_case_id: "FVI-EXC-00000000000000000000000000000041", match_issue: { code: "missing_counterpart", label: "Missing counterpart" } }], total: 41 });
    expect(db.operations).toContainEqual(["eq", "tenant_id", tenant]);
    expect(db.operations).toContainEqual(["eq", "status", "open"]);
    expect(db.operations).toContainEqual(["eq", "severity", "high"]);
    expect(db.operations).toContainEqual(["is", "lifecycle_state", null]);
    expect(db.operations).toContainEqual(["range", 40, 49]);
    expect(db.operations).toContainEqual(["select", expect.any(String), { count: "exact" }]);
    expect(db.operations.find(([op]) => op === "or")?.[1]).toContain("reason.ilike");
    expect(db.operations).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(db.operations).toContainEqual(["order", "id", { ascending: false }]);
  });

  it("escapes search wildcards and rejects invalid tenant scopes before querying", async () => {
    const db = database({ data: [], count: 0 });
    await (listExceptionPage as any)({ data: { tenant_id: tenant, page: 0, page_size: 10, q: "x%_y" }, context: db.context });
    expect(db.operations.find(([op]) => op === "or")?.[1]).toContain("x\\%\\_y");

    const untouched = database({ data: [], count: 0 });
    expect(() => (listExceptionPage as any)({ data: { tenant_id: "not-a-tenant", page: 0, page_size: 10 }, context: untouched.context })).toThrow();
    expect(untouched.operations).toHaveLength(0);
  });

  it("searches exact case and run IDs without treating the UUID as text-only", async () => {
    const caseId = "22222222-2222-4222-8222-222222222222";
    const db = database({ data: [], count: 0 });
    await (listExceptionPage as any)({ data: { tenant_id: tenant, page: 0, page_size: 10, q: caseId }, context: db.context });
    expect(db.operations.find(([op]) => op === "or")?.[1]).toContain(`id.eq.${caseId},run_id.eq.${caseId}`);
  });

  it("searches generated public case IDs exactly and normalizes their case", async () => {
    const db = database({ data: [], count: 0 });
    await (listExceptionPage as any)({ data: { tenant_id: tenant, page: 0, page_size: 10, q: "fvi-exc-abcdef0123456789abcdef0123456789" }, context: db.context });
    expect(db.operations).toContainEqual(["eq", "public_case_id", "FVI-EXC-ABCDEF0123456789ABCDEF0123456789"]);
    expect(db.operations.some(([op]) => op === "run_ilike")).toBe(false);
  });

  it("resolves the visible Run ID to a tenant-scoped run before filtering exception cases", async () => {
    const runId = "22222222-2222-4222-8222-222222222222";
    const db = database({ data: [{ id: "case-from-run" }], count: 1 }, { data: { id: runId } });
    const result = await (listExceptionPage as any)({
      data: { tenant_id: tenant, page: 0, page_size: 10, q: "R-20260924-ABCDEF0123456789" }, context: db.context,
    });
    expect(result.total).toBe(1);
    expect(db.operations).toContainEqual(["run_eq", "tenant_id", tenant]);
    expect(db.operations).toContainEqual(["run_ilike", "run_uid", "R-20260924-ABCDEF0123456789"]);
    expect(db.operations).toContainEqual(["eq", "run_id", runId]);
  });

  it("rejects PostgREST filter syntax and fails closed when exact counts are unavailable", async () => {
    const untouched = database({ data: [], count: 0 });
    expect(() => (listExceptionPage as any)({
      data: { tenant_id: tenant, page: 0, page_size: 10, q: "bad),status.eq.open" },
      context: untouched.context,
    })).toThrow();
    expect(untouched.operations).toHaveLength(0);

    const missingCount = database({ data: [], count: null });
    await expect((listExceptionPage as any)({ data: { tenant_id: tenant, page: 0, page_size: 10 }, context: missingCount.context }))
      .rejects.toThrow("Exception totals are unavailable");

    const failedRead = database({ data: [], count: null, error: { message: "PRIVATE SQL DETAIL" } });
    await expect((listExceptionPage as any)({ data: { tenant_id: tenant, page: 0, page_size: 10 }, context: failedRead.context }))
      .rejects.toThrow("Exception cases could not be loaded");
    await expect((listExceptionPage as any)({ data: { tenant_id: tenant, page: 0, page_size: 10 }, context: failedRead.context }))
      .rejects.not.toThrow("PRIVATE SQL DETAIL");
  });

  it("keeps the legacy array response for existing Break Manager callers", async () => {
    const rows = [{ id: "legacy-break" }];
    const db = database({ data: rows, count: null });
    await expect((listBreaks as any)({ data: { tenant_id: tenant, limit: 300 }, context: db.context })).resolves.toEqual(rows);
    expect(db.operations).toContainEqual(["limit", 300]);
    expect(db.operations.some(([op]) => op === "range")).toBe(false);
  });

  it("classifies only persisted engine reason prefixes and does not echo embedded key values", () => {
    expect(classifyExceptionMatchIssue("Unmatched: no counterpart on side C for key account=secret")).toEqual({ code: "missing_counterpart", label: "Missing counterpart" });
    expect(classifyExceptionMatchIssue("Invalid or missing reconciliation key: private value")).toEqual({ code: "invalid_key", label: "Invalid or missing key" });
    expect(classifyExceptionMatchIssue("Rule failed: private field amount")).toEqual({ code: "rule_failure", label: "Rule validation failure" });
    expect(classifyExceptionMatchIssue("Sum mismatch for key secret")).toEqual({ code: "aggregate_mismatch", label: "Aggregate mismatch" });
    expect(classifyExceptionMatchIssue("Unexpected provider message with details")).toEqual({ code: "other", label: "Other exception" });
  });

});
