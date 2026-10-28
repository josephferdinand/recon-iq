// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) =>
    <a href={to} {...props}>{children}</a>,
  useRouterState: () => ({ location: { pathname: "/tenant/workspace" } }),
}));

import { ScopeSwitcher } from "../src/components/scope-switcher";

afterEach(cleanup);

describe("ScopeSwitcher tenant visibility", () => {
  it("does not expose the tenant shortcut by default", () => {
    render(<ScopeSwitcher current="workspace" tenantSlug="assurance" />);
    expect(screen.queryByRole("tab", { name: "Tenant" })).toBeNull();
  });

  it("shows the tenant shortcut only when access is explicitly granted", () => {
    render(<ScopeSwitcher current="workspace" tenantSlug="assurance" canTenant />);
    expect(screen.getByRole("tab", { name: "Tenant" })).toBeTruthy();
  });
});
