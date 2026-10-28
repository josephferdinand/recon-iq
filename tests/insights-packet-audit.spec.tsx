// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ query: {} as any }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => state.query }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: any) => fn }));
vi.mock("@/lib/tenants.functions", () => ({ listRecentAudit: vi.fn() }));
import { AuditTab } from "@/components/audit-tab";
afterEach(cleanup);
const row = { id: 1, occurred_at: "2026-10-02T10:00:00Z", actor_email: null, scope: "tenant", action: "schedule.run", resource_type: "recon_run", resource_id: "entire-resource-reference", context: {} };
describe("actual tenant Audit route states", () => {
  it("does not display stale metrics or export on failed reads", () => {
    state.query = { data: [row], isSuccess: false, isError: true, isFetching: false, refetch: vi.fn() };
    render(<AuditTab tenantId="tenant" />);
    expect(screen.getByRole("alert").textContent).toContain("could not be loaded");
    expect(screen.queryByText("schedule.run")).toBeNull();
    expect((screen.getByRole("button", { name: /Export CSV/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText("Unavailable")).toHaveLength(4);
  });
  it("distinguishes missing actor attribution from SYSTEM", () => {
    state.query = { data: [row], isSuccess: true, isError: false, isFetching: false, refetch: vi.fn() };
    render(<AuditTab tenantId="tenant" />);
    expect(screen.getByText("Actor not recorded")).toBeTruthy();
    expect(screen.getByText(/entire-resource-reference/)).toBeTruthy();
    expect(screen.getByText(/bounded history/)).toBeTruthy();
    expect(screen.queryByText("system")).toBeNull();
  });
  it("does not fabricate an example or completeness proof for an empty authorized result", () => {
    state.query = { data: [], isSuccess: true, isError: false, isFetching: false, refetch: vi.fn() };
    render(<AuditTab tenantId="tenant" />);
    expect(screen.getByText(/No audit events were returned/)).toBeTruthy();
    expect(screen.getByText(/does not independently verify/)).toBeTruthy();
    expect(screen.queryByText(/jane.doe/)).toBeNull();
  });
  it("tolerates malformed historical dates without crashing the heatmap", () => {
    state.query = { data: [{ ...row, occurred_at: "unknown" }], isSuccess: true, isError: false, isFetching: false, refetch: vi.fn() };
    expect(() => render(<AuditTab tenantId="tenant" />)).not.toThrow();
  });
});
