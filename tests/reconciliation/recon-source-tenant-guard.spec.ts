import { beforeEach, describe, expect, it, vi } from "vitest";

const { runReconMock } = vi.hoisted(() => ({ runReconMock: vi.fn() }));

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
vi.mock("@/lib/ip-guard.server", () => ({ assertTenantIpAllowed: vi.fn(async () => undefined) }));
vi.mock("@/lib/rate-limit.server", () => ({ enforceServerFnRateLimit: vi.fn(async () => undefined) }));
vi.mock("@/lib/reference-data-resolver.server", () => ({
  hydrateManagedReferenceRules: vi.fn(async (_supabase, _tenantId, rules) => ({ rules, evidence: [] })),
}));
vi.mock("@/lib/recon-engine", () => ({ runRecon: runReconMock }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({ insert: async () => ({ error: null }) }) },
}));

import { runReconDefinition, upsertRecon } from "@/lib/recons.functions";

const tenantA = "11111111-1111-4111-8111-111111111111";
const sourceA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sourceB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const definitionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const runId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

type QueryResult = { data: any; error?: unknown };
type DbOptions = {
  sources?: QueryResult;
  definition?: Record<string, unknown>;
  existingDefinition?: Record<string, unknown>;
  uploads?: QueryResult;
  activeAdmin?: boolean;
};

function makeContext(options: DbOptions = {}) {
  const calls: Array<{ table: string; operations: Array<[string, ...unknown[]]> }> = [];
  const sources = options.sources ?? { data: [{ id: sourceA }, { id: sourceB }], error: null };
  const definition = {
    id: definitionId,
    tenant_id: tenantA,
    status: "active",
    governance_state: "legacy_unreviewed",
    access_mode: "legacy_passthrough",
    environment: "development",
    recon_type: "one_sided",
    sides: [{ side_id: "A", label: "Source A", data_source_id: sourceA }],
    rules: [],
    name: "Test reconciliation",
    ...options.definition,
  };

  const supabase = {
    rpc: vi.fn(async () => ({ data: true, error: null })),
    from(table: string) {
      const call = { table, operations: [] as Array<[string, ...unknown[]]> };
      calls.push(call);
      let kind = "select";
      let payload: unknown;

      const result = (): QueryResult => {
        if (table === "tenant_members") return {
          data: options.activeAdmin === false ? null : { user_id: "33333333-3333-4333-8333-333333333333" }, error: null,
        };
        if (table === "workspace_data_sources") {
          if (!Array.isArray(sources.data)) return sources;
          const idFilter = call.operations.find(([name, key]) => name === "in" && key === "id");
          const requested = idFilter?.[2] as string[] | undefined;
          return {
            ...sources,
            data: requested ? sources.data.filter((row: { id: string }) => requested.includes(row.id)) : sources.data,
          };
        }
        if (table === "workspace_data_source_uploads") return options.uploads ?? {
          data: [{ id: "upload-1", rows: [{ key: "x" }] }], error: null,
        };
        if (table === "tenant_security_settings") return { data: { max_runs_per_hour: 120 }, error: null };
        if (table === "recon_definitions" && kind === "insert") {
          return { data: { id: definitionId, recon_code: "REC-1" }, error: null };
        }
        return { data: null, error: null };
      };

      const query: any = {
        select: (...args: unknown[]) => { call.operations.push(["select", ...args]); return query; },
        eq: (...args: unknown[]) => { call.operations.push(["eq", ...args]); return query; },
        in: (...args: unknown[]) => { call.operations.push(["in", ...args]); return query; },
        order: (...args: unknown[]) => { call.operations.push(["order", ...args]); return query; },
        limit: (...args: unknown[]) => { call.operations.push(["limit", ...args]); return query; },
        insert: (value: unknown) => { kind = "insert"; payload = value; call.operations.push(["insert", value]); return query; },
        update: (value: unknown) => { kind = "update"; payload = value; call.operations.push(["update", value]); return query; },
        maybeSingle: async () => {
          if (table === "recon_definitions" && call.operations.some(([name]) => name === "eq")) {
            const idFilter = call.operations.find(([name, key]) => name === "eq" && key === "id");
            if (idFilter) {
              const selectedFields = call.operations.find(([name]) => name === "select")?.[1];
              return {
                data: selectedFields === "*" ? definition : {
                  status: "draft", governance_state: "legacy_unreviewed", access_mode: "legacy_passthrough",
                  ...options.existingDefinition,
                },
                error: null,
              };
            }
            return { data: definition, error: null };
          }
          return result();
        },
        single: async () => {
          if (table === "recon_runs" && kind === "insert") {
            return { data: { id: runId, run_uid: "FVI-RUN-TEST" }, error: null };
          }
          return result();
        },
        then: (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(result()).then(resolve, reject),
      };
      void payload;
      return query;
    },
  };

  return { context: { supabase, userId: "33333333-3333-4333-8333-333333333333" }, calls };
}

function side(id: string, label: string) {
  return { side_id: label, label, data_source_id: id };
}

function upsertInput(sides: ReturnType<typeof side>[], reconType: "one_sided" | "two_sided" | "three_sided") {
  return {
    tenant_id: tenantA,
    name: "Test reconciliation",
    recon_type: reconType,
    sides,
    rules: [],
  };
}

describe("reconciliation source tenant guard", () => {
  beforeEach(() => {
    runReconMock.mockReset();
    runReconMock.mockReturnValue({ stats: { total_rows: 1 }, matches: [], exceptions: [] });
  });

  it.each([
    ["one-sided", "one_sided", [side(sourceA, "A")]],
    ["two-sided", "two_sided", [side(sourceA, "A"), side(sourceB, "B")]],
    ["three-sided", "three_sided", [side(sourceA, "A"), side(sourceB, "B"), side(sourceA, "C")]],
  ] as const)("allows valid %s create flows with same-tenant sources", async (_label, reconType, sides) => {
    const db = makeContext({ sources: { data: [{ id: sourceA }, { id: sourceB }], error: null } });
    await (upsertRecon as any)({ data: upsertInput([...sides], reconType), context: db.context });

    const sourceCheck = db.calls.find((call) => call.table === "workspace_data_sources")!;
    expect(sourceCheck.operations).toContainEqual(["eq", "tenant_id", tenantA]);
    expect(sourceCheck.operations).toContainEqual(["in", "id", expect.arrayContaining([sourceA])]);
    expect(db.calls.some((call) => call.table === "recon_definitions" && call.operations.some(([op]) => op === "insert"))).toBe(true);
  });

  it("revalidates same-tenant sources before updating a definition", async () => {
    const db = makeContext({ existingDefinition: { status: "draft" } });
    await (upsertRecon as any)({
      data: { ...upsertInput([side(sourceA, "A")], "one_sided"), id: definitionId },
      context: db.context,
    });
    const sourceCheckIndex = db.calls.findIndex((call) => call.table === "workspace_data_sources");
    const updateIndex = db.calls.findIndex((call) => call.table === "recon_definitions" && call.operations.some(([op]) => op === "update"));
    expect(sourceCheckIndex).toBeGreaterThanOrEqual(0);
    expect(updateIndex).toBeGreaterThan(sourceCheckIndex);
  });

  it("keeps an approved production parent immutable through the direct upsert API", async () => {
    const db = makeContext({ existingDefinition: {
      status: "active", governance_state: "approved_locked", access_mode: "unmapped_pending", environment: "production",
    } });
    await expect((upsertRecon as any)({
      data: { ...upsertInput([side(sourceA, "A")], "one_sided"), id: definitionId }, context: db.context,
    })).rejects.toThrow("This reconciliation is locked.");
    expect(db.calls.some((call) => call.table === "recon_definitions" && call.operations.some(([op]) => op === "update"))).toBe(false);
  });

  it("requires an active tenant administrator for new unmapped draft creation", async () => {
    const db = makeContext({ activeAdmin: false });
    await expect((upsertRecon as any)({
      data: upsertInput([side(sourceA, "A")], "one_sided"), context: db.context,
    })).rejects.toThrow("An active tenant administrator is required");
    expect(db.calls.some((call) => call.table === "recon_definitions" && call.operations.some(([op]) => op === "insert"))).toBe(false);
  });

  it.each([
    ["foreign or unresolvable source", { data: [{ id: sourceA }], error: null }],
    ["missing source", { data: [], error: null }],
    ["source lookup error", { data: null, error: { message: "private database detail" } }],
  ])("rejects %s before persisting", async (_label, sources) => {
    const db = makeContext({ sources });
    await expect((upsertRecon as any)({
      data: upsertInput([side(sourceB, "A")], "one_sided"),
      context: db.context,
    })).rejects.toThrow("One or more reconciliation sources are unavailable in this workspace.");
    expect(db.calls.some((call) => call.table === "recon_definitions" && call.operations.some(([op]) => op === "insert" || op === "update"))).toBe(false);
  });

  it("rejects an archived definition before creating a run", async () => {
    const db = makeContext({ definition: { id: definitionId, tenant_id: tenantA, status: "archived", recon_type: "one_sided", sides: [side(sourceA, "A")], rules: [], name: "Archived" } });
    await expect((runReconDefinition as any)({ data: { tenant_id: tenantA, id: definitionId }, context: db.context }))
      .rejects.toThrow("Archived reconciliations cannot be run.");
    expect(db.calls.some((call) => call.table === "recon_runs" && call.operations.some(([op]) => op === "insert"))).toBe(false);
  });

  it("does not expose a production approved run to an analyst before Access enforcement is authoritative", async () => {
    const db = makeContext({ activeAdmin: false, definition: {
      id: definitionId, tenant_id: tenantA, status: "active", governance_state: "approved_locked",
      access_mode: "unmapped_pending", environment: "production", recon_type: "one_sided",
      sides: [side(sourceA, "A")], rules: [], name: "Approved production definition",
    } });
    await expect((runReconDefinition as any)({ data: { tenant_id: tenantA, id: definitionId }, context: db.context }))
      .rejects.toThrow("An active tenant administrator is required");
    expect(db.calls.some((call) => call.table === "recon_runs" && call.operations.some(([op]) => op === "insert"))).toBe(false);
  });

  it("rejects a source that no longer belongs to the definition tenant at run time", async () => {
    const db = makeContext({
      definition: { id: definitionId, tenant_id: tenantA, status: "active", recon_type: "one_sided", sides: [side(sourceB, "A")], rules: [], name: "Test" },
      sources: { data: [], error: null },
    });
    await expect((runReconDefinition as any)({ data: { tenant_id: tenantA, id: definitionId }, context: db.context }))
      .rejects.toThrow("One or more reconciliation sources are unavailable in this workspace.");
    expect(db.calls.some((call) => call.table === "recon_runs" && call.operations.some(([op]) => op === "insert"))).toBe(false);
  });

  it("tenant-filters upload reads before using source rows in a run", async () => {
    const db = makeContext();
    await (runReconDefinition as any)({ data: { tenant_id: tenantA, id: definitionId }, context: db.context });

    const uploadRead = db.calls.find((call) => call.table === "workspace_data_source_uploads")!;
    expect(uploadRead.operations).toContainEqual(["eq", "data_source_id", sourceA]);
    expect(uploadRead.operations).toContainEqual(["eq", "tenant_id", tenantA]);
    expect(runReconMock).toHaveBeenCalledTimes(1);
  });
});
