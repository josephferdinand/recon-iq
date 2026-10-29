// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app-shell";

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) =>
    queryKey[0] === "notifications"
      ? { data: [], isLoading: false }
      : { data: { is_platform_admin: false } },
  useQueryClient: () => ({
    cancelQueries: vi.fn(),
    getQueryData: vi.fn(),
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
  }),
  useMutation: () => ({ mutate: vi.fn() }),
}));

vi.mock("@tanstack/react-start", () => ({
  useServerFn: () => vi.fn(async () => []),
}));

vi.mock("@/lib/tenants.functions", () => ({ getMyAccess: vi.fn() }));
vi.mock("@/lib/notifications.functions", () => ({
  listNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
}));
vi.mock("@/components/command-palette", () => ({ CommandPalette: () => null }));
vi.mock("@/components/changelog-drawer", () => ({ ChangelogDrawer: () => null }));
vi.mock("@/components/user-prefs-dialog", () => ({ UserPrefsDialog: () => null }));
vi.mock("@/components/density-toggle", () => ({ DensityToggle: () => null }));
vi.mock("@/components/scope-switcher", () => ({ ScopeSwitcher: () => null }));
vi.mock("@/components/user-profile-menu", () => ({ UserProfileMenu: () => null }));
vi.mock("@/components/copilot-sheet", () => ({ CopilotSheetButton: () => null }));
vi.mock("@/components/tour-button", () => ({ TourButton: () => null }));
vi.mock("@/components/rq-seal", () => ({
  RQSeal: ({ className }: { className?: string }) => (
    <span aria-hidden="true" className={className} />
  ),
}));
vi.mock("@/hooks/use-idle-timeout", () => ({ IdleTimeoutGuard: () => null }));

beforeAll(() => {
  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    value: class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
});

afterEach(() => cleanup());

function renderShell() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const workspaceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/acme/workspace",
    component: () => (
      <AppShell
        title="Acme workspace"
        tenantSlug="acme"
        tenantId="tenant-1"
        scope="workspace"
        sidebar={
          <nav aria-label="Workspace pages">
            <Link to="/acme/workspace">Exception inbox</Link>
          </nav>
        }
      >
        <p>Workspace content</p>
      </AppShell>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([workspaceRoute]),
    history: createMemoryHistory({ initialEntries: ["/acme/workspace"] }),
  });
  return render(<RouterProvider router={router} />);
}

describe("AppShell mobile bounds", () => {
  it("uses a one-column mobile shell and exposes the full rail in a navigation sheet", async () => {
    renderShell();

    const desktopRail = await screen.findByRole("complementary", {
      name: "Primary navigation",
    });
    const shell = desktopRail.parentElement!;
    const main = screen.getByRole("main");

    expect(shell.className).toContain("grid-cols-1");
    expect(shell.className).toContain("md:grid-cols-[260px_minmax(0,1fr)]");
    expect(desktopRail.className).toContain("hidden");
    expect(desktopRail.className).toContain("md:flex");
    expect(main.className).toContain("min-w-0");

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const mobileRail = await screen.findByRole("complementary", {
      name: "Mobile primary navigation",
    });
    expect(within(mobileRail).getByRole("link", { name: "Exception inbox" })).toBeTruthy();

    fireEvent.click(within(mobileRail).getByRole("link", { name: "Exception inbox" }));
    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "Mobile primary navigation" })).toBeNull(),
    );
  });

  it("keeps header actions wrapping in view and constrains the notification popover to the viewport", async () => {
    renderShell();

    const header = await screen.findByRole("banner");
    const notifications = screen.getByRole("button", { name: "Notifications" });
    expect(header.className).toContain("flex-col");
    expect(notifications.parentElement!.className).toContain("w-full");

    fireEvent.click(notifications);
    const popover = await screen.findByLabelText("Notifications", { selector: "div" });
    expect(popover.className).toContain("w-[min(28rem,calc(100dvw-1rem))]");
    expect(popover.className).toContain("max-w-[calc(100dvw-1rem)]");
  });
});
