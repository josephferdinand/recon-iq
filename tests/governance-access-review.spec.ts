import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validate: (input: unknown) => unknown;
  const builder = {
    middleware: () => builder,
    validator: (fn: typeof validate) => { validate = fn; return builder; },
    handler: (fn: (args: unknown) => unknown) => (args: { data: unknown; context: unknown }) => fn({ ...args, data: validate(args.data) }),
  };
  return builder;
} }));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: () => ({}) }));

import {
  listGovernanceAccessReviews, getGovernanceAccessReview,
  createGovernanceAccessReviewCampaign, decideGovernanceAccessReview, listGovernanceAccessReviewOptions,
  GovernanceAccessReviewDecisionInput, GovernanceAccessReviewCampaignInput,
} from "../src/lib/governance-access-review.functions";

const tenant = "11000000-0000-4000-8000-000000000001";
const id = "11000000-0000-4000-8000-000000000002";
const key = "11000000-0000-4000-8000-000000000003";
const member = { subject_user_id: id, group_id: key, reviewer_id: tenant };
const call = async (fn: unknown, data: unknown, rpc: unknown) =>
  (fn as (arg: unknown) => Promise<unknown>)({ data, context: { supabase: { rpc, from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }) }, userId: id } });

describe("governance review authenticated server ports", () => {
  it("passes bounded defaults and exact snake-case list contract to the caller RPC", async () => {
    const page = { rows: [], total: 0, page: 1, page_size: 25, kpis: {}, permissions: {} };
    const rpc = vi.fn().mockResolvedValue({ data: page, error: null });
    expect(await call(listGovernanceAccessReviews, { tenant_id: tenant }, rpc)).toEqual(page);
    expect(rpc).toHaveBeenCalledWith("governance_access_review_list", { _input: { tenant_id: tenant, page: 1, page_size: 25, search: "" } });
  });
  it("forwards exact immutable snapshot/version/reason/request-key without an acting-user parameter", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { outcome: "revoked" }, error: null });
    const data = { tenant_id: tenant, id, expected_version: 3, snapshot_hash: "a".repeat(64), decision: "revoke", reason: "  Assignment ended  ", request_key: key };
    await call(decideGovernanceAccessReview, data, rpc);
    expect(rpc).toHaveBeenCalledWith("governance_access_review_decide", { _input: { ...data, reason: "Assignment ended" } });
  });
  it("uses detail and campaign purpose RPCs, retaining broad group context", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id }, error: null });
    await call(getGovernanceAccessReview, { tenant_id: tenant, id }, rpc);
    expect(rpc).toHaveBeenLastCalledWith("governance_access_review_get", { _input: { tenant_id: tenant, id } });
    const campaign = { tenant_id: tenant, name: "Certification", due_at: "2026-12-01T12:00:00Z", request_key: key, memberships: [member] };
    await call(createGovernanceAccessReviewCampaign, campaign, rpc);
    expect(rpc).toHaveBeenLastCalledWith("governance_access_review_campaign_create", { _input: campaign });
  });
  it.each([
    { tenant_id: tenant, page_size: 101 }, { tenant_id: tenant, page: 0 },
    { tenant_id: tenant, actor_id: id }, { tenant_id: tenant, role: "service_role" },
    { tenant_id: tenant, outcome: "approved" }, { tenant_id: tenant, search: "a".repeat(161) },
  ])("rejects unsupported bounds, authority and enums: %j", async data => {
    const rpc = vi.fn();
    await expect(call(listGovernanceAccessReviews, data, rpc)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses duplicate campaign memberships and arbitrary rights", () => {
    const data = { tenant_id: tenant, name: "Q4", due_at: "2026-12-01T00:00:00Z", request_key: key };
    expect(GovernanceAccessReviewCampaignInput.safeParse({ ...data, memberships: [member, member] }).success).toBe(false);
    expect(GovernanceAccessReviewCampaignInput.safeParse({ ...data, memberships: [{ ...member, rights: ["admin"] }] }).success).toBe(false);
  });
  it("passes first-campaign paged options with association filters, without profile/actor authority", async () => {
    const result = { rows: [{ id, label: null, group_id: key, current_rights: ["reconciliation:source:view"], snapshot_hash: "a".repeat(64) }], total: 1, page: 1, page_size: 25 };
    const rpc = vi.fn().mockResolvedValue({ data: result, error: null });
    expect(await call(listGovernanceAccessReviewOptions, { tenant_id: tenant, kind: "members", group_id: key }, rpc)).toEqual(result);
    expect(rpc).toHaveBeenCalledWith("governance_access_review_options", { _input: { tenant_id: tenant, kind: "members", group_id: key, page: 1, page_size: 25, search: "" } });
  });
  it.each(["", " ", "a".repeat(2001)])("requires a bounded meaningful reason", reason => {
    expect(GovernanceAccessReviewDecisionInput.safeParse({ tenant_id: tenant, id, expected_version: 1, snapshot_hash: "a".repeat(64), decision: "retain", reason, request_key: key }).success).toBe(false);
  });
  it("propagates authorization/transport failure instead of inventing an empty successful result", async () => {
    await expect(call(listGovernanceAccessReviews, { tenant_id: tenant }, vi.fn().mockResolvedValue({ data: null, error: { message: "Current membership missing", code: "42501" } }))).rejects.toThrow("Current membership missing");
    await expect(call(getGovernanceAccessReview, { tenant_id: tenant, id }, vi.fn().mockResolvedValue({ data: null, error: null }))).rejects.toThrow("no result");
  });
});
