import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (value: unknown) => value;
    const chain = {
      middleware: () => chain,
      validator: (fn: (value: unknown) => unknown) => {
        validate = fn;
        return chain;
      },
      handler: (fn: (args: unknown) => unknown) => (args: { data: unknown; context: unknown }) =>
        fn({ ...args, data: validate(args.data) }),
    };
    return chain;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: () => vi.fn() }));

import { assertReconAction, runReconDefinition, upsertRecon } from "@/lib/recons.functions";

const tenantId = "11111111-1111-4111-8111-111111111111";
const definitionId = "22222222-2222-4222-8222-222222222222";
const sourceId = "33333333-3333-4333-8333-333333333333";
const actorId = "44444444-4444-4444-8444-444444444444";
type TestQuery = {
  select: (...args: unknown[]) => TestQuery;
  eq: (...args: unknown[]) => TestQuery;
  maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: null }>;
  update: () => TestQuery;
  in: (...args: unknown[]) => Promise<{ data: Array<{ id: string }>; error: null }>;
  insert: (...args: unknown[]) => Promise<{ error: null }>;
};

function callHandler(handler: unknown, args: unknown) {
  return (handler as (input: unknown) => Promise<unknown>)(args);
}

function updateContext(accessAllowed: boolean, updateApplied = true) {
  const calls: string[] = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push(`rpc:${name}`);
    if (name === "recon_authoritative_access_decision") return { data: accessAllowed, error: null };
    return { data: false, error: null };
  });
  const from = vi.fn((table: string): TestQuery => {
    calls.push(`from:${table}`);
    if (table === "recon_definitions") {
      const query: TestQuery = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: {
            id: definitionId,
            tenant_id: tenantId,
            status: "draft",
            governance_state: "development_draft",
            access_mode: "mapped_exact",
            environment: "development",
          },
          error: null,
        }),
        update: () => {
          const updateQuery: TestQuery = {
            eq: () => updateQuery,
            select: () => updateQuery,
            maybeSingle: async () => ({
              data: updateApplied ? { id: definitionId } : null,
              error: null,
            }),
          };
          return updateQuery;
        },
      };
      return query;
    }
    if (table === "workspace_data_sources") {
      const query: TestQuery = {
        select: () => query,
        eq: () => query,
        in: async () => ({ data: [{ id: sourceId }], error: null }),
      };
      return query;
    }
    if (table === "audit_log") {
      return {
        insert: async () => ({ error: null }),
      } as TestQuery;
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  return { supabase: { rpc, from }, rpc, from, calls };
}

const editInput = {
  id: definitionId,
  tenant_id: tenantId,
  name: "Mapped draft",
  description: null,
  recon_type: "one_sided" as const,
  sides: [{ side_id: "A", label: "Source A", data_source_id: sourceId }],
  rules: [],
};

describe("actor-bound reconciliation edit/run authorization", () => {
  it("uses the authenticated action decision without accepting an actor override", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    await expect(assertReconAction({ rpc }, definitionId, "edit")).resolves.toBeUndefined();
    await expect(assertReconAction({ rpc }, definitionId, "run")).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("recon_authoritative_access_decision", {
      _recon: definitionId,
      _action: "edit",
    });
    expect(rpc).toHaveBeenCalledWith("recon_authoritative_access_decision", {
      _recon: definitionId,
      _action: "run",
    });
  });

  it("allows a mapped BU-granted editor through the guarded draft update path", async () => {
    const db = updateContext(true);
    await expect(
      callHandler(upsertRecon, {
        data: editInput,
        context: { supabase: db.supabase, userId: actorId },
      }),
    ).resolves.toEqual({ id: definitionId });

    expect(db.rpc).toHaveBeenCalledWith("recon_authoritative_access_decision", {
      _recon: definitionId,
      _action: "edit",
    });
    expect(db.rpc).not.toHaveBeenCalledWith("has_tenant_role", expect.anything());
    expect(db.calls).not.toContain("from:tenant_members");
    expect(db.calls).toContain("from:workspace_data_sources");
  });

  it("denies a mapped edit before source reads or writes when the actor has no edit grant", async () => {
    const db = updateContext(false);
    await expect(
      callHandler(upsertRecon, {
        data: editInput,
        context: { supabase: db.supabase, userId: actorId },
      }),
    ).rejects.toThrow("You do not have access to edit this reconciliation.");

    expect(db.calls).toEqual(["from:recon_definitions", "rpc:recon_authoritative_access_decision"]);
  });

  it("does not report success or audit an update if access disappears before the RLS write", async () => {
    const db = updateContext(true, false);
    await expect(
      callHandler(upsertRecon, {
        data: editInput,
        context: { supabase: db.supabase, userId: actorId },
      }),
    ).rejects.toThrow("This reconciliation could not be updated with the current access.");

    expect(db.calls).toContain("from:recon_definitions");
    expect(db.calls).not.toContain("from:audit_log");
  });

  it("denies a mapped run before IP checks, rate limits, or run creation without run access", async () => {
    const rpc = vi.fn(async () => ({ data: false, error: null }));
    const from = vi.fn((table: string): TestQuery => {
      if (table !== "recon_definitions")
        throw new Error(`Unexpected pre-authorization table: ${table}`);
      const query: TestQuery = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: {
            id: definitionId,
            tenant_id: tenantId,
            status: "draft",
            governance_state: "development_draft",
            access_mode: "mapped_exact",
            environment: "development",
          },
          error: null,
        }),
      };
      return query;
    });
    await expect(
      callHandler(runReconDefinition, {
        data: { id: definitionId, tenant_id: tenantId },
        context: { supabase: { rpc, from }, userId: actorId },
      }),
    ).rejects.toThrow("You do not have access to run this reconciliation.");
    expect(rpc).toHaveBeenCalledWith("recon_authoritative_access_decision", {
      _recon: definitionId,
      _action: "run",
    });
    expect(from).toHaveBeenCalledTimes(1);
  });
});
