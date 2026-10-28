// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), retry: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.query, useMutation: vi.fn(), useQueryClient: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: any) => fn }));
vi.mock("@/lib/batch-bc.functions", () => ({ computeAgeing: vi.fn(), listEodSignoffs: vi.fn(), prepareEodSignoff: vi.fn(), approveEodSignoff: vi.fn() }));
vi.mock("@/components/substantiation-drawer", () => ({ SubstantiationDrawer: () => null }));
import { AgeingTab } from "@/components/ageing-eod-tabs";
const empty = { count: 0, limit: 500, has_more: false, unknown_age: 0, observed_at: "2026-10-02T12:00:00Z", rows: [], buckets: [] };
describe("exception ageing read states", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.clearAllMocks(); mocks.query.mockReturnValue({ data: undefined, isFetching: true, isError: false, refetch: mocks.retry }); });
  it("shows loading without false zero-dollar metrics", () => {
    render(<AgeingTab tenantId="tenant" canWrite={false} />);
    expect(screen.getByRole("status").textContent).toContain("Loading");
    expect(screen.queryByRole("table")).toBeNull();
  });
  it("hides cached metrics on read failure and offers retry without raw errors", () => {
    mocks.query.mockReturnValue({ data: { ...empty, count: 42 }, isFetching: false, isError: true, error: new Error("42501 private SQL permission denied"), refetch: mocks.retry });
    render(<AgeingTab tenantId="tenant" canWrite={false} />);
    expect(screen.getByRole("alert").textContent).toContain("could not be loaded");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/private SQL/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.retry).toHaveBeenCalledOnce();
  });
  it("distinguishes no visible rows from a tenant-wide zero and allows reader refresh", () => {
    mocks.query.mockReturnValue({ data: empty, isFetching: false, isError: false, refetch: mocks.retry });
    render(<AgeingTab tenantId="tenant" canWrite={false} />);
    expect(screen.getByText(/not a tenant-wide zero/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(mocks.retry).toHaveBeenCalledOnce();
  });
  it("does not display stale data during refresh", () => {
    mocks.query.mockReturnValue({ data: { ...empty, count: 42 }, isFetching: true, isError: false, refetch: mocks.retry });
    render(<AgeingTab tenantId="tenant" canWrite />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByText("42 visible records")).toBeNull();
  });
});
