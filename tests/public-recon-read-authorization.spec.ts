import { describe, expect, it, vi, beforeEach } from "vitest";
const { state, rpc, authorize } = vi.hoisted(() => {
  const state = { ok: true, scopes: ["recons.read"], result: null as unknown, error: null as null | { code: string } };
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ data: state.result, error: state.error }));
  const authorize = vi.fn(async () => state.ok
    ? { ok: true, principal: { tokenId: "11111111-1111-4111-8111-111111111111", tenantId: "22222222-2222-4222-8222-222222222222", actorUserId: "33333333-3333-4333-8333-333333333333", scopes: state.scopes }, admin: { rpc }, cors: {} }
    : { ok: false, response: Response.json({ error: "tenant_scope_mismatch" }, { status: 403 }) });
  return { state, rpc, authorize };
});
vi.mock("@/lib/public-workflow-api.server", () => ({ authorizeTenantApiRequest: authorize, workflowApiJson: (status: number, body: unknown) => Response.json(body, { status }), workflowApiCors: () => ({}) }));
import { listPublicReconRunHistory, getPublicReconRunResults } from "@/lib/public-recon-read-authorization.server";
const recon = "44444444-4444-4444-8444-444444444444", runId = "55555555-5555-4555-8555-555555555555";
const summary = { id: runId, run_uid: "R-example", definition_id: recon, status: "completed", matched_count: 1, exception_count: 0, total_rows: 2, started_at: "2026-10-02T10:00:00Z", completed_at: null, matched_input_memberships: 2 };
const request = (query = "") => new Request(`https://example.invalid/api/history${query}`);
beforeEach(() => { vi.clearAllMocks(); state.ok = true; state.scopes = ["recons.read"]; state.error = null; state.result = { rows: [summary], total: 51, page: 1, page_size: 50, has_next: true, audit_id: "123" }; });
describe("purpose reconciliation run reads", () => {
  it("uses only the verified token and target, with no actor/JWT override", async () => {
    const result = await listPublicReconRunHistory(request(), "qa", recon);
    expect(result.status).toBe(200);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ requiredScope: "recons.read", tenantSlug: "qa", methods: "GET" }));
    const args = rpc.mock.calls[0]?.[1] as unknown as Record<string, unknown>;
    expect(args).toMatchObject({ _token_id: "11111111-1111-4111-8111-111111111111", _tenant_id: "22222222-2222-4222-8222-222222222222", _recon_id: recon, _mode: "history", _page: 1 });
    expect(args).not.toHaveProperty("_actor"); expect(args).not.toHaveProperty("_jwt");
  });
  it("denies wrong tenant before the data RPC", async () => { state.ok = false; expect((await listPublicReconRunHistory(request(), "other", recon)).status).toBe(403); expect(rpc).not.toHaveBeenCalled(); });
  it("requires explicit read scope rather than a legacy wildcard", async () => { state.scopes = ["*"]; expect((await listPublicReconRunHistory(request(), "qa", recon)).status).toBe(403); expect(rpc).not.toHaveBeenCalled(); });
  it.each(["?page=0", "?page=1&page=2", "?actor_id=other", "?days=365", "?page=NaN"])("rejects invalid/override query %s", async query => { expect((await listPublicReconRunHistory(request(query), "qa", recon)).status).toBe(400); expect(rpc).not.toHaveBeenCalled(); });
  it.each(["42501", "P0002"])("denies revoked/ungranted/unknown resource on %s", async code => { state.error = { code }; expect((await listPublicReconRunHistory(request(), "qa", recon)).status).toBe(404); });
  it("fails closed on absent RPC/audit failure and never attempts a fallback read", async () => { state.error = { code: "42883" }; expect((await listPublicReconRunHistory(request(), "qa", recon)).status).toBe(503); expect(rpc).toHaveBeenCalledTimes(1); });
  it("returns safe unavailable on rejected database transport", async () => { rpc.mockRejectedValueOnce(new Error("private transport detail")); const res = await listPublicReconRunHistory(request(), "qa", recon); expect(res.status).toBe(503); expect(await res.text()).not.toContain("private"); });
  it("requires a committed audit receipt before returning rows", async () => { state.result = { rows: [summary], total: 1, page: 1, page_size: 50, has_next: false }; expect((await listPublicReconRunHistory(request(), "qa", recon)).status).toBe(503); });
  it.each(["0", "invalid", "-1", "1.5", "9223372036854775808", "9999999999999999999", 9007199254740993])("rejects invalid int8 receipt %s", async audit_id => {
    state.result = { rows: [summary], total: 1, page: 1, page_size: 50, has_next: false, audit_id };
    expect((await listPublicReconRunHistory(request(), "qa", recon)).status).toBe(503);
  });
  it("preserves the full positive int8 range as a string", async () => {
    state.result = { rows: [summary], total: 1, page: 1, page_size: 50, has_next: false, audit_id: "9223372036854775807" };
    const response = await listPublicReconRunHistory(request(), "qa", recon);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ audit_id: "9223372036854775807" });
  });
  it("rejects exact-run mismatches", async () => {
    state.result = { run: { ...summary, id: recon }, results: [], field_names: [], parent_count: 0, page: 1, page_size: 50, has_next: false, status_counts: null, audit_id: "124" };
    expect((await getPublicReconRunResults(request(), "qa", recon, runId)).status).toBe(503);
  });
  it("rejects mismatched definition results", async () => { state.result = { rows: [{ ...summary, definition_id: runId }], total: 1, page: 1, page_size: 50, has_next: false, audit_id: "123" }; expect((await listPublicReconRunHistory(request(), "qa", recon)).status).toBe(503); });
  it("returns bounded exact results with unknown counts preserved", async () => { state.result = { run: summary, results: [], field_names: [], parent_count: null, page: 2, page_size: 50, has_next: false, status_counts: null, audit_id: "124" }; const res = await getPublicReconRunResults(request("?page=2&status=missing"), "qa", recon, runId); expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ parent_count: null, status_counts: null, page: 2 }); });
});
