import { beforeEach, describe, expect, it, vi } from "vitest";

// Handler/DTO proof only. Separate native qualification executes real SQL/auth/RLS/audit.
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validate: (input: unknown) => unknown;
  const builder = {
    middleware: () => builder,
    validator: (fn: typeof validate) => { validate = fn; return builder; },
    handler: (fn: (input: unknown) => unknown) => (input: { data: unknown; context: unknown }) => fn({ ...input, data: validate(input.data) }),
  };
  return builder;
} }));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: () => ({}) }));
import * as backend from "../src/lib/governance-membership.functions";

const tenant = "20000000-0000-4000-8000-000000000001";
const actor = "20000000-0000-4000-8000-000000000002";
const id = "20000000-0000-4000-8000-000000000003";
const requestKey = "20000000-0000-4000-8000-000000000004";
const rpc = vi.fn();
const context = { userId: actor, supabase: { rpc } };
const call = (name: keyof typeof backend, data: unknown, ctx = context) =>
  (backend[name] as unknown as (input: { data: unknown; context: typeof context }) => Promise<unknown>)({ data, context: ctx });
beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: { id, status: "pending", version: 1 }, error: null }); });

describe("Membership ordinary-caller server ports", () => {
  it("passes full paging/filter scope to the caller RPC", async () => {
    const result = { rows: [], total: 37, kpis: { awaiting_decision: 37 } };
    rpc.mockResolvedValue({ data: result, error: null });
    expect(await call("listGovernanceMembershipRequests", { tenant_id: tenant, page: 2, page_size: 10, search: " Cash ", status: "pending", bu_id: id, environment: "dev" })).toEqual(result);
    expect(rpc).toHaveBeenCalledWith("list_governance_membership_requests", {
      _tenant_id: tenant, _page: 2, _page_size: 10, _search: "Cash", _status: "pending", _bu_id: id, _environment: "dev", _own_only: false,
    });
  });
  it("defaults pages without replacing a refusal with an empty list", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Active tenant membership required" } });
    await expect(call("listGovernanceMembershipRequests", { tenant_id: tenant })).rejects.toMatchObject({ code: "42501" });
    expect(rpc.mock.calls[0][1]).toMatchObject({ _page: 1, _page_size: 25, _search: "" });
  });
  it("passes purpose-only self scope without accepting a selected actor", async () => {
    await call("listGovernanceMembershipRequests", { tenant_id: tenant, own_only: true });
    expect(rpc.mock.calls[0][1]).toMatchObject({ _own_only: true, _tenant_id: tenant });
    expect(() => backend.governanceMembershipListSchema.parse({ tenant_id: tenant, own_only: true, requested_by: actor })).toThrow();
    expect(() => backend.governanceMembershipListSchema.parse({ tenant_id: tenant, own_only: "true" })).toThrow();
  });
  it("gets the exact tenant request", async () => {
    await call("getGovernanceMembershipRequest", { tenant_id: tenant, request_id: id });
    expect(rpc).toHaveBeenCalledWith("get_governance_membership_request", { _tenant_id: tenant, _request_id: id });
  });
  it("submits no acting user or fabricated rights", async () => {
    await call("submitGovernanceMembershipRequest", { tenant_id: tenant, bu_id: id, workspace_id: id, group_id: id, environment: "prod", reason: "  Assigned operations  ", request_key: requestKey });
    expect(rpc.mock.calls[0]).toEqual(["submit_governance_membership_request", {
      _tenant_id: tenant, _bu_id: id, _workspace_id: id, _group_id: id, _environment: "prod", _reason: "Assigned operations", _request_key: requestKey,
    }]);
  });
  it.each(["actor_id", "user_id", "requested_by", "requested_rights", "aal", "role", "service_role"])("refuses client %s", (field) => {
    expect(() => backend.governanceMembershipSubmitSchema.parse({ tenant_id: tenant, bu_id: id, workspace_id: id, group_id: id, environment: "dev", reason: "Access", request_key: requestKey, [field]: actor })).toThrow();
  });
  it("decides and withdraws with exact version/reason/key", async () => {
    const input = { tenant_id: tenant, request_id: id, expected_version: 3, reason: "Reviewed", request_key: requestKey };
    await call("decideGovernanceMembershipRequest", { ...input, decision: "approve" });
    expect(rpc.mock.calls[0][1]).toEqual({ _tenant_id: tenant, _request_id: id, _expected_version: 3, _decision: "approve", _reason: "Reviewed", _request_key: requestKey });
    await call("withdrawGovernanceMembershipRequest", input);
    expect(rpc.mock.calls[1][0]).toBe("withdraw_governance_membership_request");
  });
  it.each([{ expected_version: 0 }, { reason: " " }, { request_key: "bad" }, { decision: "grant_admin" }, { actor_id: actor }])("refuses invalid mutation %j", (change) => {
    expect(() => backend.governanceMembershipDecisionSchema.parse({ tenant_id: tenant, request_id: id, expected_version: 1, reason: "Reviewed", request_key: requestKey, decision: "reject", ...change })).toThrow();
  });
  it.each([{ page_size: 101 }, { page: 0 }, { search: "x".repeat(201) }, { environment: "staging" }])("bounds list inputs %j", (change) => {
    expect(() => backend.governanceMembershipListSchema.parse({ tenant_id: tenant, ...change })).toThrow();
  });
  it("requires middleware actor and rejects null authoritative results", async () => {
    await expect(call("getGovernanceMembershipRequest", { tenant_id: tenant, request_id: id }, { ...context, userId: "" })).rejects.toThrow("Authenticated caller");
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(call("getGovernanceMembershipRequest", { tenant_id: tenant, request_id: id })).rejects.toThrow("authoritative result");
  });
  it("uses exact named option kinds and dependency fields", async () => {
    await call("listGovernanceMembershipOptions", { tenant_id: tenant, kind: "group", bu_id: id, workspace_id: id, page: 3, page_size: 50, search: "Cash" });
    expect(rpc.mock.calls[0]).toEqual(["list_governance_membership_options", {
      _tenant_id: tenant, _kind: "group", _page: 3, _page_size: 50, _search: "Cash", _bu_id: id, _workspace_id: id, _environment: null,
    }]);
    expect(() => backend.governanceMembershipOptionsSchema.parse({ tenant_id: tenant, kind: "group", bu_id: id })).toThrow();
    expect(backend.governanceMembershipOptionsSchema.parse({ tenant_id: tenant, kind: "environment" }).kind).toBe("environment");
  });
});
