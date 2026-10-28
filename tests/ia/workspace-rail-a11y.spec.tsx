// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { WorkspaceRail, type WorkspaceRailSection } from "@/components/workspace-rail";

const SECTIONS: WorkspaceRailSection[] = [
  {
    key: "home",
    label: "Home",
    pages: [
      { key: "dashboard", label: "Dashboard" },
      { key: "overview", label: "Overview" },
    ],
  },
  {
    key: "data-prep",
    label: "Data Prep",
    pages: [{ key: "pipelines", label: "Build pipeline" }],
  },
  {
    key: "reconciliations",
    label: "Reconciliations",
    pages: [
      { key: "matching", label: "Matching" },
      {
        key: "my-templates",
        label: "My Templates",
        to: "/acme/workspace/templates",
      },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    pages: [
      { key: "report-library", label: "Report library" },
      { key: "report-schedules", label: "Report schedules" },
    ],
  },
  { key: "empty", label: "Empty section", pages: [] },
];

function renderInRouter(content: ReactNode, initialEntry = "/?tenant=acme&view=dense") {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => content,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  const rendered = render(<RouterProvider router={router} />);
  return { ...rendered, router };
}

beforeEach(() => {
  cleanup();
});

describe("WorkspaceRail", () => {
  it("keeps Home direct while every other non-empty section has a disclosure", async () => {
    renderInRouter(<WorkspaceRail sections={SECTIONS} activeKey="dashboard" basePath="/" />);

    expect(await screen.findByRole("link", { name: "Home" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Toggle Home" })).toBeNull();
    expect(screen.getByRole("button", { name: "Toggle Data Prep" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Toggle Reports" })).toBeTruthy();
  });

  it("uses separate parent links and chevrons with a single-open accordion", async () => {
    const { router } = renderInRouter(
      <WorkspaceRail sections={SECTIONS} activeKey="dashboard" basePath="/" />,
    );
    const dataToggle = await screen.findByRole("button", { name: "Toggle Data Prep" });
    const reportsToggle = screen.getByRole("button", { name: "Toggle Reports" });

    expect(dataToggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(dataToggle);
    expect(dataToggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(reportsToggle);
    expect(reportsToggle.getAttribute("aria-expanded")).toBe("true");
    expect(dataToggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(screen.getByRole("link", { name: "Data Prep" }));
    await waitFor(() => {
      expect(dataToggle.getAttribute("aria-expanded")).toBe("true");
      expect(router.state.location.search.page).toBe("pipelines");
    });
  });

  it("builds canonical links while preserving unrelated search parameters", async () => {
    renderInRouter(
      <WorkspaceRail sections={SECTIONS} activeKey="report-library" basePath="/acme/workspace" />,
    );
    const link = await screen.findByRole("link", { name: "Report schedules" });
    const url = new URL(link.getAttribute("href")!, "https://fvi.test");

    expect(url.pathname).toBe("/acme/workspace");
    expect(url.searchParams.get("tenant")).toBe("acme");
    expect(url.searchParams.get("view")).toBe("dense");
    expect(url.searchParams.get("page")).toBe("report-schedules");
  });

  it("uses an explicit page destination, clears stale page search, and keeps its group active", async () => {
    renderInRouter(
      <WorkspaceRail sections={SECTIONS} activeKey="my-templates" basePath="/acme/workspace" />,
      "/?tenant=acme&view=dense&page=starter-kits",
    );
    const link = await screen.findByRole("link", { name: "My Templates" });
    const parent = screen.getByRole("link", { name: "Reconciliations" });
    const url = new URL(link.getAttribute("href")!, "https://fvi.test");

    expect(url.pathname).toBe("/acme/workspace/templates");
    expect(url.searchParams.get("tenant")).toBe("acme");
    expect(url.searchParams.get("view")).toBe("dense");
    expect(url.searchParams.has("page")).toBe(false);
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(link.style.backgroundColor).toBe("var(--brand-gold)");
    expect(parent.parentElement!.parentElement!.style.borderLeftColor).toBe("var(--brand-gold)");
    expect(
      screen.getByRole("button", { name: "Toggle Reconciliations" }).getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("follows activeKey changes while allowing the active group to be collapsed manually", async () => {
    function Harness() {
      const [activeKey, setActiveKey] = useState("report-library");
      return (
        <>
          <button type="button" onClick={() => setActiveKey("report-schedules")}>
            Activate report schedules
          </button>
          <button type="button" onClick={() => setActiveKey("pipelines")}>
            Activate data prep
          </button>
          <WorkspaceRail sections={SECTIONS} activeKey={activeKey} basePath="/" />
        </>
      );
    }

    renderInRouter(<Harness />);
    const reportsToggle = await screen.findByRole("button", { name: "Toggle Reports" });
    const dataToggle = screen.getByRole("button", { name: "Toggle Data Prep" });

    expect(reportsToggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(reportsToggle);
    expect(reportsToggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Activate report schedules" }));
    await waitFor(() => expect(reportsToggle.getAttribute("aria-expanded")).toBe("true"));

    fireEvent.click(screen.getByRole("button", { name: "Activate data prep" }));
    await waitFor(() => {
      expect(dataToggle.getAttribute("aria-expanded")).toBe("true");
      expect(reportsToggle.getAttribute("aria-expanded")).toBe("false");
    });
  });

  it("marks only the active page current and applies the gold active treatment", async () => {
    renderInRouter(<WorkspaceRail sections={SECTIONS} activeKey="report-library" basePath="/" />);
    const activeChild = await screen.findByRole("link", { name: "Report library" });
    const parent = screen.getByRole("link", { name: "Reports" });
    const parentHeader = parent.parentElement!;
    const sectionContainer = parentHeader.parentElement!;

    expect(activeChild.getAttribute("aria-current")).toBe("page");
    expect(activeChild.style.backgroundColor).toBe("var(--brand-gold)");
    expect(activeChild.style.color).toBe("rgb(14, 26, 48)");
    expect(parent.getAttribute("aria-current")).toBeNull();
    expect(sectionContainer.style.borderLeftColor).toBe("var(--brand-gold)");
    expect(sectionContainer.style.color).toBe("var(--brand-gold)");
    expect(sectionContainer.className).toContain(
      "bg-sidebar-accent",
    );
    expect(sectionContainer.contains(activeChild)).toBe(true);
    expect(sectionContainer.contains(screen.getByRole("button", { name: "Toggle Reports" }))).toBe(
      true,
    );
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
  });

  it("keeps Home gold for Overview without marking the Dashboard destination current", async () => {
    renderInRouter(<WorkspaceRail sections={SECTIONS} activeKey="overview" basePath="/" />);
    const home = await screen.findByRole("link", { name: "Home" });

    expect(home.style.backgroundColor).toBe("var(--brand-gold)");
    expect(home.style.color).toBe("rgb(14, 26, 48)");
    expect(home.getAttribute("aria-current")).toBeNull();
    expect(new URL(home.getAttribute("href")!, "https://fvi.test").searchParams.get("page")).toBe(
      "dashboard",
    );
  });

  it("omits empty sections and removes collapsed child links from the tab order", async () => {
    renderInRouter(<WorkspaceRail sections={SECTIONS} activeKey="dashboard" basePath="/" />);
    expect(screen.queryByText("Empty section")).toBeNull();

    const collapsedLink = await screen.findByRole("link", {
      name: "Build pipeline",
      hidden: true,
    });
    expect(collapsedLink.tabIndex).toBe(-1);
    expect(collapsedLink.closest("[hidden]")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Toggle Data Prep" }));
    expect(collapsedLink.tabIndex).toBe(0);
    expect(collapsedLink.closest("[hidden]")).toBeNull();
  });
});
