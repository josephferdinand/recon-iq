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

import { importReconDefinitions } from "@/lib/recon-defs-io.functions";

const tenantId = "11111111-1111-4111-8111-111111111111";
const ownerBuId = "22222222-2222-4222-8222-222222222222";
const sourceId = "33333333-3333-4333-8333-333333333333";
const payload = {
  format: "fvi-recon-defs/v1",
  count: 1,
  definitions: [{
    recon_code: "FVI-GEN-2WAY-000001",
    name: "Imported draft",
    description: null,
    recon_type: "one_sided",
    status: "active",
    sides: [{ side_id: "A", data_source_id: sourceId }],
    rules: [],
  }],
};

function context(data: unknown = { inserted: 1, updated: 0, skipped: 0 }, error: { message?: string } | null = null) {
  const rpc = vi.fn(async () => ({ data, error }));
  return { supabase: { rpc }, rpc };
}

describe("reconciliation definition import adapter", () => {
  it("requires explicit owners and sends only editable content to the atomic tenant RPC", async () => {
    const db = context();
    await expect((importReconDefinitions as any)({
      data: { tenant_id: tenantId, payload, owner_bu_ids: [ownerBuId], mode: "skip" },
      context: { supabase: db.supabase },
    })).resolves.toEqual({ inserted: 1, updated: 0, skipped: 0 });
    expect(db.rpc).toHaveBeenCalledWith("import_recon_definitions_with_owners", {
      _tenant_id: tenantId,
      _definitions: [{
        name: "Imported draft", description: null, recon_type: "one_sided",
        sides: [{ side_id: "A", data_source_id: sourceId }], rules: [],
      }],
      _owner_bu_ids: [ownerBuId],
      _mode: "skip",
    });
  });

  it("rejects missing or duplicate owner selections before calling the database", async () => {
    const db = context();
    expect(() => (importReconDefinitions as any)({
      data: { tenant_id: tenantId, payload, owner_bu_ids: [], mode: "skip" }, context: { supabase: db.supabase },
    })).toThrow();
    expect(() => (importReconDefinitions as any)({
      data: { tenant_id: tenantId, payload, owner_bu_ids: [ownerBuId, ownerBuId], mode: "skip" }, context: { supabase: db.supabase },
    })).toThrow();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("does not expose database error details as the user-facing failure", async () => {
    const db = context(null, { message: "PGRST202 private schema detail" });
    await expect((importReconDefinitions as any)({
      data: { tenant_id: tenantId, payload, owner_bu_ids: [ownerBuId], mode: "skip" }, context: { supabase: db.supabase },
    })).rejects.toThrow("The import could not be completed. Check the definitions and owning business units, then try again.");
  });
});
