import { describe, expect, it, vi } from "vitest";
import { saveCollateralCsaAccessHandler } from "@/lib/collateral-csa.functions";
import {
  RESOURCE_ACCESS_TYPES,
  RESOURCE_ACTOR_TYPES,
  grantCollateralScheduleGroupActionHandler,
  revokeCollateralScheduleGroupActionHandler,
  saveCollateralScheduleAccessHandler,
} from "@/lib/resource-access-summaries.functions";

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const scheduleId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const agreementId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ownerBuId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const groupId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const grantId = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function mockContext(result: unknown = { registered: true }) {
  const rpc = vi.fn(async () => ({ data: result, error: null }));
  return { context: { supabase: { rpc } }, rpc };
}

describe("collateral typed-resource ABI", () => {
  it("adds schedule and CSA agreement to access summaries without widening actor-summary support", () => {
    expect(RESOURCE_ACCESS_TYPES).toContain("collateral_schedule");
    expect(RESOURCE_ACCESS_TYPES).toContain("collateral_csa_agreement");
    expect(RESOURCE_ACTOR_TYPES as readonly string[]).not.toContain("collateral_schedule");
    expect(RESOURCE_ACTOR_TYPES as readonly string[]).not.toContain("collateral_csa_agreement");
  });

  it("saves schedule owner/view mappings through the existing typed-resource handler", async () => {
    const { context, rpc } = mockContext();
    const result = await saveCollateralScheduleAccessHandler({
      context,
      data: {
        tenant_id: tenantId,
        schedule_id: scheduleId,
        owner_bu_ids: [ownerBuId, ownerBuId],
        group_ids: [groupId, groupId],
        reason: "Synthetic collateral mapping",
      },
    });
    expect(result).toEqual({ registered: true });
    expect(rpc).toHaveBeenCalledWith("save_typed_data_resource_access", {
      _tenant_id: tenantId,
      _resource_type: "collateral_schedule",
      _resource_id: scheduleId,
      _owner_bu_ids: [ownerBuId],
      _group_ids: [groupId],
      _reason: "Synthetic collateral mapping",
    });
  });

  it("uses only the collateral-schedule purpose RPC for group action grants and revokes", async () => {
    const grant = mockContext(grantId);
    const grantResult = await grantCollateralScheduleGroupActionHandler({
      context: grant.context,
      data: {
        tenant_id: tenantId,
        schedule_id: scheduleId,
        bu_id: ownerBuId,
        group_id: groupId,
        action: "run",
        reason: "Synthetic run probe",
      },
    });
    expect(grantResult).toBe(grantId);
    expect(grant.rpc).toHaveBeenCalledWith("grant_collateral_schedule_group_action", {
      _tenant_id: tenantId,
      _schedule_id: scheduleId,
      _bu_id: ownerBuId,
      _group_id: groupId,
      _action: "run",
      _reason: "Synthetic run probe",
    });

    const revoke = mockContext(true);
    await revokeCollateralScheduleGroupActionHandler({
      context: revoke.context,
      data: { tenant_id: tenantId, schedule_id: scheduleId, grant_id: grantId, reason: "Remove synthetic grant" },
    });
    expect(revoke.rpc).toHaveBeenCalledWith("revoke_collateral_schedule_group_action", {
      _tenant_id: tenantId,
      _schedule_id: scheduleId,
      _grant_id: grantId,
      _reason: "Remove synthetic grant",
    });
  });

  it("rejects generic approve/manage actions and maps CSA access through its maker-checker-aware handler", async () => {
    const invalid = mockContext();
    for (const action of ["approve", "manage"] as const) {
      await expect(grantCollateralScheduleGroupActionHandler({
        context: invalid.context,
        data: {
          tenant_id: tenantId,
          schedule_id: scheduleId,
          bu_id: ownerBuId,
          group_id: groupId,
          action,
          reason: "Attempt generic approval",
        },
      })).rejects.toThrow();
    }
    expect(invalid.rpc).not.toHaveBeenCalled();

    const csa = mockContext();
    await saveCollateralCsaAccessHandler({
      context: csa.context as never,
      data: {
        tenant_id: tenantId,
        agreement_id: agreementId,
        owner_bu_ids: [ownerBuId],
        group_ids: [groupId],
        reason: "Synthetic CSA view mapping",
      },
    });
    expect(csa.rpc).toHaveBeenCalledWith("save_collateral_csa_access", {
      _tenant_id: tenantId,
      _agreement_id: agreementId,
      _owner_bu_ids: [ownerBuId],
      _group_ids: [groupId],
      _reason: "Synthetic CSA view mapping",
    });
  });
});
