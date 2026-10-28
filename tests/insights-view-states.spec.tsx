// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn(), request: vi.fn(), export: vi.fn(), error: vi.fn(), success: vi.fn(), retry: vi.fn(), access: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.query, useMutation: mocks.mutation, useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: any) => fn }));
vi.mock("@/hooks/use-access", () => ({ useAccess: mocks.access }));
vi.mock("@/lib/agent.functions", () => ({ runAgent: mocks.request, listAgentRuns: vi.fn() }));
vi.mock("@/lib/lineage.functions", () => ({ listLineageEdges: vi.fn(), lineageEvidencePack: mocks.export }));
vi.mock("@/lib/my-audit.functions", () => ({ listMyWorkspaceAudit: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: mocks.success, info: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/components/break-grid-editor", () => ({ BreakGridEditor: () => null }));
vi.mock("@/components/pivot-panel", () => ({ PivotPanel: () => null }));
vi.mock("@/components/saved-views-bar", () => ({ SavedViewsBar: () => null }));
vi.mock("@/components/document-split-viewer", () => ({ DocumentSplitViewer: () => null }));
vi.mock("@tanstack/react-router", () => ({ Link: () => null }));
import { AgentTab } from "@/components/agent-tab";
import { LineageTab } from "@/components/lineage-tab";
import { MyAuditTrail } from "@/components/my-audit-trail";
import { guardProductivityPivot } from "@/components/productivity-tab";
const ready = { isLoading: false, isFetching: false, isError: false, refetch: mocks.retry };
describe("Insights honest view/control states", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockReturnValue({ ...ready, data: [] });
    mocks.mutation.mockReturnValue({ isPending: false, mutate: vi.fn() });
    mocks.access.mockReturnValue({ access: { user_id: "current-actor" }, isLoading: false, isError: false, refetch: mocks.retry });
  });
  it("does not invent Agent history, and disabled AI cannot request analysis", () => {
    render(<AgentTab tenantId="tenant" aiEnabled={false} canWrite />);
    expect(screen.getByRole("button", { name: "Request analysis" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/separate histories/)).toBeTruthy();
    expect(screen.queryByText(/1,247|Supervised|writes allowed/)).toBeNull();
  });
  it("requests read-only analysis and does not toast a failed outcome as success", async () => {
    render(<AgentTab tenantId="tenant" aiEnabled canWrite />);
    const config = mocks.mutation.mock.calls[0][0];
    await config.mutationFn();
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ autonomy: "read_only" }) }));
    config.onSuccess({ id: "run", status: "failed" });
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("did not complete"));
    expect(mocks.success).not.toHaveBeenCalled();
  });
  it("hides stale Agent outcomes after history failure", () => {
    mocks.query.mockReturnValue({ ...ready, isError: true, error: new Error("Forbidden"), data: [{ id: "old", objective: "stale objective", created_at: "2026-10-02", steps: [] }] });
    render(<AgentTab tenantId="tenant" aiEnabled canWrite />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText("stale objective")).toBeNull();
  });
  it("uses reviewed AI configuration failure copy without displaying credential-field internals", () => {
    render(<AgentTab tenantId="tenant" aiEnabled canWrite />);
    mocks.mutation.mock.calls[0][0].onError(new Error("Platform AI provider not configured (missing FVI_AI_API_KEY / vault credential)"));
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("current AI configuration or limits"));
    expect(mocks.error.mock.calls[0][0]).not.toContain("FVI_AI_API_KEY");
  });
  it("keeps unloaded lineage distinct from empty/complete lineage", () => {
    mocks.query.mockReturnValue({ ...ready, isFetching: true, data: [] });
    render(<LineageTab tenantId="tenant" />);
    expect(screen.getByRole("status").textContent).toContain("Loading");
    expect(screen.queryByText(/0 loaded links/)).toBeNull();
    expect(screen.getByRole("button", { name: "Export recorded links" }).hasAttribute("disabled")).toBe(true);
  });
  it("focuses recorded relationships and handles a failed export without an unhandled success", async () => {
    mocks.query.mockReturnValue({ ...ready, data: [{ id: "e", source_kind: "upload", source_ref: "source", source_label: "Input", target_kind: "recon", target_ref: "target", target_label: "Output", transform: null, recorded_at: "2026-10-02", recorded_by: null }] });
    mocks.export.mockRejectedValue(new Error("private SQL unavailable"));
    render(<LineageTab tenantId="tenant" />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: JSON.stringify(["recon", "target"]) } });
    expect(screen.getByText("Transformation not recorded")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Export recorded links" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.export).toHaveBeenCalledWith({ data: { tenant_id: "tenant", target_kind: "recon", target_ref: "target" } });
    expect(mocks.success).not.toHaveBeenCalled();
  });
  it("shows missing audit identity as unavailable rather than loading forever", () => {
    mocks.access.mockReturnValue({ access: null, isLoading: false, isError: false, refetch: mocks.retry });
    render(<MyAuditTrail tenantId="tenant" />);
    expect(screen.getByRole("alert").textContent).toContain("identity could not be verified");
  });
  it("shows permitted resource/hash details without claiming chain verification", () => {
    mocks.query.mockReturnValue({ ...ready, data: { actor_id: "current-actor", has_more: false, rows: [{ id: 1, action: "resource.read", occurred_at: "2026-10-02T12:00:00Z", scope: "workspace", resource_type: "data_source", resource_id: "source-reference", row_hash: "recorded-hash", prev_hash: null }] } });
    render(<MyAuditTrail tenantId="tenant" />);
    expect(screen.getByText("source-reference")).toBeTruthy();
    expect(screen.getByText("recorded-hash")).toBeTruthy();
    expect(screen.getByText(/has not verified the audit chain/)).toBeTruthy();
  });
  it("retains currency for mixed monetary grouping and rejects malformed saved views", () => {
    expect(guardProductivityPivot({ rowFields: ["category"], valueField: "amount", agg: "sum", colField: "status" }, true)?.rowFields).toEqual(["category", "currency"]);
    expect(guardProductivityPivot({ rowFields: ["__proto__"] }, true)).toBeNull();
    expect(guardProductivityPivot({ rowFields: "malformed" }, false)).toBeNull();
  });
});
