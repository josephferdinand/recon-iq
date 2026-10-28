// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { queryResult } = vi.hoisted(() => ({ queryResult: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => queryResult(),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => vi.fn(async () => ({})) }));
vi.mock("@/lib/access.functions", () => ({ getMyAccess: vi.fn() }));
vi.mock("@/lib/access-audit.functions", () => ({ logAccessDecision: vi.fn() }));

import { PageGate, PermissionGate } from "@/hooks/use-access";

afterEach(cleanup);
beforeEach(() => queryResult.mockReturnValue({ isLoading: false, isError: true, data: undefined, refetch: vi.fn() }));

describe("permission gate outage", () => {
  it("does not call a failed lookup a denied page", () => {
    render(<PageGate tenantId="tenant-a" permission="recon.read" pageLabel="Recon">secret page</PageGate>);
    expect(screen.getByRole("alert").textContent).toContain("Access information temporarily unavailable");
    expect(screen.queryByText("secret page")).toBeNull();
    expect(screen.queryByText(/Access denied/)).toBeNull();
    expect(screen.getByRole("button", { name: "Retry access check" })).toBeTruthy();
  });

  it("withholds inline protected content while reporting temporary unavailability", () => {
    render(<PermissionGate tenantId="tenant-a" permission="recon.read">secret control</PermissionGate>);
    expect(screen.getByRole("alert").textContent).toContain("We could not verify this action");
    expect(screen.queryByText("secret control")).toBeNull();
  });

  it("explains a real denial without exposing internal permission identifiers", () => {
    queryResult.mockReturnValue({
      isLoading: false, isError: false,
      data: { is_platform_admin: false, tenant_role: "operator", permission_ids: [] },
      refetch: vi.fn(),
    });
    render(<PageGate tenantId="tenant-a" permission="internal.recon.read" pageLabel="Recon">secret page</PageGate>);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("You Don't Currently Have Access");
    expect(alert.textContent).toContain("Contact your administrator");
    expect(alert.textContent).not.toContain("internal.recon.read");
    expect(screen.getByRole("link", { name: "Return to Home" })).toBeTruthy();
  });
});
