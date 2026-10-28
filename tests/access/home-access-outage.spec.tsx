// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({}),
  useNavigate: () => vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => vi.fn() }));
vi.mock("@/lib/tenants.functions", () => ({ getMyAccess: vi.fn(), listMyTenants: vi.fn() }));
vi.mock("@/lib/members.functions", () => ({ listMyInvitations: vi.fn() }));
vi.mock("@/lib/auth-landing.functions", () => ({ setDefaultTenant: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "my-tenants") return { data: [], isSuccess: true, isLoading: false, isError: false };
    if (queryKey[0] === "my-access") return { data: undefined, isLoading: false, isError: true, refetch: vi.fn() };
    if (queryKey[0] === "profile-default-tenant") return { data: undefined, isPending: false, isError: true };
    return { data: [] };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  SidebarLink: () => null,
  SidebarSection: () => null,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: null } }) } },
}));

import { HomePage } from "@/routes/_authenticated/home";

afterEach(cleanup);

describe("Home access outage", () => {
  it("does not claim that a user lacks tenants or a default when access queries fail", () => {
    render(<HomePage />);
    expect(screen.getByRole("alert").textContent).toContain("Access information temporarily unavailable");
    expect(screen.getByText("Access information unavailable. Retry the access check above.")).toBeTruthy();
    expect(screen.getByText("Temporarily unavailable")).toBeTruthy();
    expect(screen.queryByText("Nothing To Display Yet")).toBeNull();
    expect(screen.queryByText("Not set — picker shown")).toBeNull();
  });
});
