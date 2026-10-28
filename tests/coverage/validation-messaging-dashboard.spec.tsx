// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { queryState } = vi.hoisted(() => ({
  queryState: {
    current: {
      isError: true,
      isFetching: false,
      refetch: vi.fn(),
      data: undefined,
    },
  },
}));

vi.mock("@tanstack/react-query", () => ({ useQuery: () => queryState.current }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/dashboard.functions", () => ({ getWorkspaceAnalytics: vi.fn() }));

import { WorkspaceDashboard } from "@/components/workspace-dashboard";

afterEach(() => {
  cleanup();
  queryState.current.refetch.mockClear();
});

describe("VMG-HOME-TEAM-001 dashboard failure message", () => {
  it("renders an accessible failure alert and invokes the existing Retry action", () => {
    render(<WorkspaceDashboard tenantId="qa-tenant-fixture" tenantName="QA tenant" />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Workspace dashboard unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(queryState.current.refetch).toHaveBeenCalledTimes(1);
  });

  it.fails("does not guess that the user's connection caused a service-side dashboard failure", () => {
    render(<WorkspaceDashboard tenantId="qa-tenant-fixture" tenantName="QA tenant" />);
    expect(screen.getByRole("alert").textContent).not.toContain("Check your connection");
  });
});
