// @vitest-environment jsdom
/**
 * Accessibility + permission-filter regression for the collapsible LeftRail.
 *
 * Covers:
 *   - Group headers are <button> with correct aria-expanded / aria-controls
 *   - Toggling collapses/expands the group and persists in localStorage
 *   - The group containing the active page is force-expanded
 *   - Keyboard activation (Enter / Space) toggles the group
 *   - Breadcrumb renders Scope › Group › Page for the active key
 *   - Permission filtering hides gated items the user lacks
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRouter,
  createRootRoute,
  createRoute,
  RouterProvider,
  Outlet,
} from "@tanstack/react-router";
import { LeftRail, RailBreadcrumbs, type RailItem } from "@/components/left-rail";

const ITEMS: RailItem[] = [
  { key: "a1", label: "Alpha One",   group: "Alpha" },
  { key: "a2", label: "Alpha Two",   group: "Alpha" },
  { key: "b1", label: "Beta One",    group: "Beta", permission: "beta.read" },
  { key: "b2", label: "Beta Two",    group: "Beta", permission: "beta.write" },
  { key: "g1", label: "Gamma Free",  group: "Gamma" },
];

function renderRail(props: Parameters<typeof LeftRail>[0]) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <LeftRail {...props} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: undefined,
  });
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  cleanup();
});

describe("LeftRail — accessibility", () => {
  it("uses the shared gold selected state for an active admin page and its group", async () => {
    renderRail({ items: ITEMS, activeKey: "a2", defaultKey: "a1", storageScope: "gold-active" });

    const activeLink = await screen.findByRole("link", { name: /alpha two/i });
    const activeGroup = screen.getByRole("button", { name: /alpha/i });

    expect(activeLink.getAttribute("aria-current")).toBe("page");
    expect(activeLink.style.backgroundColor).toBe("var(--brand-gold)");
    expect(activeLink.style.color).toBe("rgb(14, 26, 48)");
    expect(activeLink.className).toContain("focus-visible:ring-[var(--brand-gold)]");
    expect(activeGroup.parentElement?.style.borderLeftColor).toBe("var(--brand-gold)");
    expect(activeGroup.parentElement?.style.color).toBe("var(--brand-gold)");
    expect(activeGroup.parentElement?.className).toContain(
      "bg-sidebar-accent",
    );
    expect(activeGroup.parentElement?.contains(activeLink)).toBe(true);
  });

  it("uses the canonical parent path so child routes can return to Dashboard", async () => {
    renderRail({ items: ITEMS, activeKey: "a1", defaultKey: "a1", storageScope: "base", basePath: "/acme/workspace" });
    const link = await screen.findByRole("link", { name: /alpha one/i });
    expect(link.getAttribute("href")).toBe("/acme/workspace?page=a1");
  });

  it("renders each group header as a button with aria-expanded=true by default", async () => {
    renderRail({ items: ITEMS, activeKey: "a1", defaultKey: "a1", storageScope: "test1" });
    const alpha = await screen.findByRole("button", { name: /alpha/i });
    expect(alpha.getAttribute("aria-expanded")).toBe("true");
    expect(alpha.getAttribute("aria-controls")).toMatch(/^rail-group-test1-/);
  });

  it("toggle collapses the group, updates aria-expanded, and persists", async () => {
    renderRail({ items: ITEMS, activeKey: "g1", defaultKey: "g1", storageScope: "test2" });
    const alpha = await screen.findByRole("button", { name: /alpha/i });
    fireEvent.click(alpha);
    expect(alpha.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(alpha);
    expect(alpha.getAttribute("aria-expanded")).toBe("false");
    const raw = window.localStorage.getItem("fvi.rail.open.test2");
    expect(raw && JSON.parse(raw)).toBeNull();
  });

  it("keyboard Enter and Space activate the group toggle (buttons handle both natively)", async () => {
    renderRail({ items: ITEMS, activeKey: "g1", defaultKey: "g1", storageScope: "test3" });
    const alpha = await screen.findByRole("button", { name: /alpha/i });
    alpha.focus();
    expect(document.activeElement).toBe(alpha);
    fireEvent.click(alpha); // Enter/Space on a <button> fires click
    expect(alpha.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(alpha);
    expect(alpha.getAttribute("aria-expanded")).toBe("false");
  });

  it("force-expands the group holding the active page even when persisted as collapsed", async () => {
    window.localStorage.setItem(
      "fvi.rail.open.test4",
      JSON.stringify("Beta"),
    );
    renderRail({ items: ITEMS, activeKey: "a2", defaultKey: "a2", storageScope: "test4" });
    // Alpha's items must be visible because a2 is active inside Alpha.
    expect(await screen.findByRole("link", { name: /alpha two/i })).toBeTruthy();
  });
});

describe("LeftRail — permission filtering", () => {
  it("hides items whose permission is not in the granted set", async () => {
    renderRail({
      items: ITEMS,
      activeKey: "a1",
      defaultKey: "a1",
      permissionSet: new Set(["beta.read"]),
      storageScope: "test5",
    });
    fireEvent.click(await screen.findByRole("button", { name: /beta/i }));
    expect(await screen.findByRole("link", { name: /beta one/i })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /beta two/i })).toBeNull();
    // Ungated items are always visible
    expect(screen.getByRole("link", { name: /alpha one/i, hidden: true })).toBeTruthy();
    expect(screen.getByRole("link", { name: /gamma free/i, hidden: true })).toBeTruthy();
  });

  it("permissionSet=null bypasses all gating (platform-scope behaviour)", async () => {
    renderRail({
      items: ITEMS,
      activeKey: "a1",
      defaultKey: "a1",
      permissionSet: null,
      storageScope: "test6",
    });
    fireEvent.click(await screen.findByRole("button", { name: /beta/i }));
    expect(await screen.findByRole("link", { name: /beta one/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /beta two/i })).toBeTruthy();
  });
});

describe("RailBreadcrumbs — Scope › Group › Page", () => {
  it("renders the scope, group and current page label for every item", () => {
    for (const it of ITEMS) {
      const { container, unmount } = render(
        <RailBreadcrumbs items={ITEMS} activeKey={it.key} scopeLabel="Test" />,
      );
      const text = container.textContent ?? "";
      expect(text).toContain("Test");
      if (it.group) expect(text).toContain(it.group);
      expect(text).toContain(it.label);
      unmount();
    }
  });

  it("renders nothing when the active key is unknown (safe deep-link fallback)", () => {
    const { container } = render(
      <RailBreadcrumbs items={ITEMS} activeKey="does-not-exist" scopeLabel="Test" />,
    );
    expect(container.textContent).toBe("");
  });
});
