import { describe, expect, it, vi } from "vitest";
import {
  getReconAccessSetupHandler,
  cutoverLegacyReconDefinitionHandler,
  grantReconBuActionHandler,
  revokeReconBuActionHandler,
  setReconOwnersHandler,
} from "@/lib/recon-access-setup.functions";

const reconId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const buId = "33333333-3333-4333-8333-333333333333";
const principalId = "44444444-4444-4444-8444-444444444444";
const grantId = "55555555-5555-4555-8555-555555555555";

function context(data: unknown, error: { message?: string } | null = null) {
  const rpc = vi.fn(async () => ({ data, error }));
  return { context: { supabase: { rpc } }, rpc };
}

describe("multi-BU access setup RPC adapter", () => {
  it("returns persisted setup and calls the exact read RPC argument", async () => {
    const result = {
      recon_id: reconId,
      tenant_id: tenantId,
      multi_bu_governed: false,
      is_tenant_admin: true,
      owners: [],
      grants: [{ grant_id: grantId, bu_id: buId, principal_type: "user", principal_id: principalId, action: "read", granted_at: "2026-09-24T00:00:00Z" }],
      effective_access: { view: false, run: false, edit: false, approve: false },
      available_business_units: [],
      available_principals: [],
    };
    const { context: ctx, rpc } = context(result);
    await expect(getReconAccessSetupHandler({ data: { recon_id: reconId }, context: ctx })).resolves.toMatchObject({ grants: [{ action: "view" }] });
    expect(rpc).toHaveBeenCalledWith("get_recon_access_setup", { _recon_id: reconId });
  });

  it("does not turn missing RPCs or malformed data into empty access", async () => {
    const missing = context(null, { message: "PGRST202" });
    await expect(getReconAccessSetupHandler({ data: { recon_id: reconId }, context: missing.context })).rejects.toThrow("temporarily unavailable");
    const malformed = context({ recon_id: reconId, owners: [], grants: [] });
    await expect(getReconAccessSetupHandler({ data: { recon_id: reconId }, context: malformed.context })).rejects.toThrow("temporarily unavailable");
  });

  it("deduplicates owner IDs while preserving the reason and exact RPC args", async () => {
    const { context: ctx, rpc } = context([buId]);
    await setReconOwnersHandler({ data: { recon_id: reconId, bu_ids: [buId, buId], reason: "Owner reviewed" }, context: ctx });
    expect(rpc).toHaveBeenCalledWith("set_recon_owners", { _recon_id: reconId, _bu_ids: [buId], _reason: "Owner reviewed" });
  });

  it("sends exact grant and revoke payloads and rejects an unconfirmed revoke", async () => {
    const grantContext = context(grantId);
    await grantReconBuActionHandler({ data: { recon_id: reconId, bu_id: buId, principal_type: "group", principal_id: principalId, action: "view", reason: "Approved scope" }, context: grantContext.context });
    expect(grantContext.rpc).toHaveBeenCalledWith("grant_recon_bu_action", {
      _recon_id: reconId, _bu_id: buId, _principal_type: "group", _principal_id: principalId, _action: "view", _reason: "Approved scope",
    });

    const revokeContext = context(true);
    await expect(revokeReconBuActionHandler({ data: { grant_id: grantId, reason: "Remove access" }, context: revokeContext.context })).resolves.toBe(true);
    expect(revokeContext.rpc).toHaveBeenCalledWith("revoke_recon_bu_action", { _grant_id: grantId, _reason: "Remove access" });
    const noChange = context(false);
    await expect(revokeReconBuActionHandler({ data: { grant_id: grantId, reason: "Remove access" }, context: noChange.context })).rejects.toThrow("temporarily unavailable");
  });

  it("calls the governed legacy cutover RPC with exact actor and mapping inputs", async () => {
    const { context: ctx, rpc } = context({ recon_id: reconId, access_mode: "mapped_exact", governance_state: "legacy_mapped", owner_bu_ids: [buId], audit_receipt_id: grantId });
    await expect(cutoverLegacyReconDefinitionHandler({ data: { tenant_id: tenantId, recon_id: reconId, owner_bu_ids: [buId, buId], maker_user_id: principalId, checker_user_id: grantId, reason: "Reviewed synthetic mapping" }, context: ctx })).resolves.toMatchObject({ access_mode: "mapped_exact" });
    expect(rpc).toHaveBeenCalledWith("cutover_legacy_recon_definition_mapping", {
      _tenant_id: tenantId, _recon_id: reconId, _owner_bu_ids: [buId], _maker_user_id: principalId, _checker_user_id: grantId, _reason: "Reviewed synthetic mapping",
    });
  });

  it("fails closed on same-user or malformed cutover responses", async () => {
    const sameActor = context({});
    await expect(cutoverLegacyReconDefinitionHandler({ data: { tenant_id: tenantId, recon_id: reconId, owner_bu_ids: [buId], maker_user_id: principalId, checker_user_id: principalId, reason: "Reviewed mapping" }, context: sameActor.context })).rejects.toThrow();
    const malformed = context({ recon_id: reconId, access_mode: "legacy_passthrough" });
    await expect(cutoverLegacyReconDefinitionHandler({ data: { tenant_id: tenantId, recon_id: reconId, owner_bu_ids: [buId], maker_user_id: principalId, checker_user_id: grantId, reason: "Reviewed mapping" }, context: malformed.context })).rejects.toThrow("temporarily unavailable");
  });
});
