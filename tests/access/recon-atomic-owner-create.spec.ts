import { describe, expect, it, vi } from "vitest";
import { createReconDefinitionWithOwners } from "@/lib/recons.functions";

const tenantId = "22222222-2222-4222-8222-222222222222";
const buId = "33333333-3333-4333-8333-333333333333";
const reconId = "11111111-1111-4111-8111-111111111111";

function client(data: unknown, error: { code?: string; message?: string } | null = null) {
  const rpc = vi.fn(async () => ({ data, error }));
  return { supabase: { rpc }, rpc };
}

describe("atomic reconciliation creation with owners", () => {
  it("calls the owner-bound RPC with deduplicated BU ids and returns its identity", async () => {
    const { supabase, rpc } = client([{ id: reconId, recon_code: "FVI-GEN-2WAY-000091" }]);
    const result = await createReconDefinitionWithOwners(supabase, {
      tenant_id: tenantId,
      name: "Daily settlement",
      description: "Match settlement rows",
      recon_type: "two_sided",
      sides: [{ side_id: "A" }, { side_id: "B" }],
      rules: [],
      owner_bu_ids: [buId, buId],
    });

    expect(result).toEqual({ id: reconId, recon_code: "FVI-GEN-2WAY-000091" });
    expect(rpc).toHaveBeenCalledWith("create_recon_definition_with_owners", {
      _tenant_id: tenantId,
      _name: "Daily settlement",
      _description: "Match settlement rows",
      _recon_type: "two_sided",
      _sides: [{ side_id: "A" }, { side_id: "B" }],
      _rules: [],
      _owner_bu_ids: [buId],
    });
  });

  it("uses safe access and validation errors without exposing provider details", async () => {
    const denied = client(null, { code: "42501", message: "private database detail" });
    await expect(createReconDefinitionWithOwners(denied.supabase, {
      tenant_id: tenantId, name: "A recon", recon_type: "one_sided", sides: [], rules: [], owner_bu_ids: [buId],
    })).rejects.toThrow("do not have access");

    const invalidOwners = client(null, { code: "22023", message: "private database detail" });
    await expect(createReconDefinitionWithOwners(invalidOwners.supabase, {
      tenant_id: tenantId, name: "A recon", recon_type: "one_sided", sides: [], rules: [], owner_bu_ids: [buId],
    })).rejects.toThrow("at least one active owning business unit");

    const malformed = client([{ id: reconId }]);
    await expect(createReconDefinitionWithOwners(malformed.supabase, {
      tenant_id: tenantId, name: "A recon", recon_type: "one_sided", sides: [], rules: [], owner_bu_ids: [buId],
    })).rejects.toThrow("temporarily unavailable");
  });
});
