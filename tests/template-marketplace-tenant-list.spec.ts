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
vi.mock("./ai-inference.functions", () => ({ executeInference: vi.fn() }));

import { getTenantTemplateLatestRun, getTenantTemplateLifecycle, listTenantTemplatesPage } from "@/lib/template-marketplace.functions";

const tenantA = "11111111-1111-4111-8111-111111111111";
const tenantTemplateId = "22222222-2222-4222-8222-222222222222";

type Call = { table: string; operations: Array<[string, ...unknown[]]> };
function makeContext(options: { templates?: any[]; definitions?: any[]; run?: any; runError?: unknown; auditEvents?: any[]; auditError?: unknown } = {}) {
  const calls: Call[] = [];
  const supabase = {
    from(table: string) {
      const call = { table, operations: [] as Array<[string, ...unknown[]]> };
      calls.push(call);
      const rows = table === "tenant_templates" ? options.templates ?? []
        : table === "recon_definitions" ? options.definitions ?? []
          : table === "recon_runs" ? options.run ? [options.run] : []
            : table === "mkt_audit_log" ? options.auditEvents ?? [] : [];
      const query: any = {
        select: (...args: unknown[]) => { call.operations.push(["select", ...args]); return query; },
        eq: (...args: unknown[]) => { call.operations.push(["eq", ...args]); return query; },
        ilike: (...args: unknown[]) => { call.operations.push(["ilike", ...args]); return query; },
        or: (...args: unknown[]) => { call.operations.push(["or", ...args]); return query; },
        in: (...args: unknown[]) => { call.operations.push(["in", ...args]); return query; },
        order: (...args: unknown[]) => { call.operations.push(["order", ...args]); return query; },
        range: (from: number, to: number) => {
          call.operations.push(["range", from, to]);
          return Promise.resolve({ data: rows.slice(from, to + 1), count: rows.length, error: null });
        },
        limit: (count: number) => { call.operations.push(["limit", count]); return query; },
        maybeSingle: async () => {
          call.operations.push(["maybeSingle"]);
          return { data: rows[0] ?? null, error: table === "recon_runs" ? options.runError ?? null : null };
        },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({
          data: rows,
          error: table === "mkt_audit_log" ? options.auditError ?? null : null,
        }).then(resolve, reject),
      };
      return query;
    },
  };
  return { context: { supabase }, calls };
}

function template(index: number, ownerLabel: string | null = "Operations") {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    tenant_id: tenantA,
    title: `Template ${index}`,
    description: `Reconciliation template ${index}`,
    current_semver: "1.0.0",
    status: "published",
    created_at: "2026-09-24T10:00:00Z",
    updated_at: "2026-09-24T11:00:00Z",
    submitted_by: "33333333-3333-4333-8333-333333333333",
    submitted_at: "2026-09-24T10:20:00Z",
    approved_by: "44444444-4444-4444-8444-444444444444",
    approved_at: "2026-09-24T10:30:00Z",
    spec: { asset_class: "Cash", owner_label: ownerLabel, sides: [{ side_id: "A" }, { side_id: "B" }] },
  };
}

describe("My Templates paged list and related run summary", () => {
  it("uses tenant-scoped exact-count server filters before stable paging", async () => {
    const db = makeContext({ templates: [template(1)] });
    const result = await (listTenantTemplatesPage as any)({
      data: { tenant_id: tenantA, page: 2, page_size: 25, search: "Cash", asset_class: "Cash", status: "published" },
      context: db.context,
    });
    const call = db.calls[0];
    const operations = call.operations;
    expect(result).toMatchObject({ total: 1, page: 2, page_size: 25, total_pages: 1 });
    expect(operations).toContainEqual(["eq", "tenant_id", tenantA]);
    expect(operations).toContainEqual(["eq", "status", "published"]);
    expect(operations).toContainEqual(["ilike", "spec->>asset_class", "%Cash%"]);
    expect(operations.find(([name]) => name === "select")?.[2]).toEqual({ count: "exact" });
    expect(operations).toContainEqual(["order", "id", { ascending: true }]);
    expect(operations).toContainEqual(["range", 25, 49]);
  });

  it("pages all 400 tenant templates without client-side filtering or duplicates", async () => {
    const db = makeContext({ templates: Array.from({ length: 400 }, (_, index) => template(index + 1)) });
    const seen: string[] = [];
    for (let page = 1; page <= 4; page++) {
      const result = await (listTenantTemplatesPage as any)({
        data: { tenant_id: tenantA, page, page_size: 100 },
        context: db.context,
      });
      expect(result.total).toBe(400);
      expect(result.rows).toHaveLength(100);
      seen.push(...result.rows.map((row: any) => row.id));
    }
    expect(db.calls.map((call) => call.operations.find(([name]) => name === "range"))).toEqual([
      ["range", 0, 99], ["range", 100, 199], ["range", 200, 299], ["range", 300, 399],
    ]);
    expect(seen).toHaveLength(400);
    expect(new Set(seen).size).toBe(400);
  });

  it("returns safe list metadata and marks absent asset/owner data as unavailable", async () => {
    const db = makeContext({ templates: [template(1, "reviewer@example.com"), template(2, "33333333-3333-4333-8333-333333333333")] });
    const result = await (listTenantTemplatesPage as any)({ data: { tenant_id: tenantA }, context: db.context });
    expect(result.rows[0]).toMatchObject({ asset_class: "Cash", sides_count: 2, owner_label: null, submitted_by_recorded: true, approved_by_recorded: true });
    expect(result.rows[1]).toMatchObject({ owner_label: null });
    expect(JSON.stringify(result)).not.toContain("reviewer@example.com");
    expect(JSON.stringify(result)).not.toContain("33333333-3333-4333-8333-333333333333");
  });

  it("returns only visible tenant-linked run details and never substitutes a raw UUID", async () => {
    const defA = "55555555-5555-4555-8555-555555555555";
    const runUid = "FVI-RUN-TEST-000001";
    const db = makeContext({
      templates: [{ id: tenantTemplateId, tenant_id: tenantA }],
      definitions: [{ id: defA }],
      run: { run_uid: runUid, status: "completed", started_at: "2026-09-24T12:00:00Z", total_rows: 40, matched_count: 35, exception_count: 5 },
    });
    const result = await (getTenantTemplateLatestRun as any)({ data: { tenant_id: tenantA, tenant_template_id: tenantTemplateId }, context: db.context });
    expect(result).toEqual({ state: "available", run: { run_uid: runUid, status: "completed", started_at: "2026-09-24T12:00:00Z", total_rows: 40, matched_count: 35, exception_count: 5 } });
    expect(db.calls[1].operations).toContainEqual(["eq", "tenant_id", tenantA]);
    expect(db.calls[1].operations).toContainEqual(["eq", "tenant_template_id", tenantTemplateId]);
    expect(db.calls[2].operations).toContainEqual(["eq", "tenant_id", tenantA]);
    expect(db.calls[2].operations).toContainEqual(["in", "definition_id", [defA]]);
    expect(JSON.stringify(result)).not.toContain(defA);
  });

  it("does not call hidden linked definitions or mislabel an empty visible set as never-run", async () => {
    const db = makeContext({ templates: [{ id: tenantTemplateId, tenant_id: tenantA }], definitions: [] });
    const result = await (getTenantTemplateLatestRun as any)({ data: { tenant_id: tenantA, tenant_template_id: tenantTemplateId }, context: db.context });
    expect(result).toEqual({ state: "unavailable", run: null });
    expect(db.calls).toHaveLength(2);
  });

  it("returns authoritative lifecycle events with actor evidence but without actor or source UUIDs", async () => {
    const actorId = "66666666-6666-4666-8666-666666666666";
    const sourceReconId = "77777777-7777-4777-8777-777777777777";
    const db = makeContext({
      templates: [{ id: tenantTemplateId, tenant_id: tenantA }],
      auditEvents: [{
        action: "approve",
        created_at: "2026-09-24T10:00:00Z",
        actor_id: actorId,
        before: { semver: "1.1.0", source_recon_definition_id: sourceReconId },
        after: { semver: "1.1.0", source_recon_definition_id: sourceReconId },
      }],
    });
    const result = await (getTenantTemplateLifecycle as any)({ data: { tenant_id: tenantA, tenant_template_id: tenantTemplateId }, context: db.context });
    expect(result).toMatchObject([{ action: "approve", actor_role: "Checker", actor_recorded: true, version: "1.1.0" }]);
    expect(JSON.stringify(result)).not.toContain(actorId);
    expect(JSON.stringify(result)).not.toContain(sourceReconId);
    expect(db.calls[1].operations).toContainEqual(["eq", "tenant_id", tenantA]);
    expect(db.calls[1].operations).toContainEqual(["eq", "entity_id", tenantTemplateId]);
  });
});
