// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { api } = vi.hoisted(() => ({
  api: { listDataSources: vi.fn(), listSchedules: vi.fn(), listWatchers: vi.fn() },
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: unknown }) => <a>{children as any}</a> }));
vi.mock("@/lib/data-sources.functions", () => ({ listDataSources: api.listDataSources }));
vi.mock("@/lib/connectors.functions", () => ({ listSchedules: api.listSchedules }));
vi.mock("@/lib/watchers.functions", () => ({ listWatchers: api.listWatchers }));
vi.mock("@/components/native-parser-panel", () => ({ NativeParserPanel: () => null }));

import { IngestionHub } from "@/components/ingestion-hub";

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(<QueryClientProvider client={client}><IngestionHub tenantId="11111111-1111-4111-8111-111111111111" slug="qa" /></QueryClientProvider>);
  return client;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("workspace ingestion summary messages", () => {
  it("shows actual counts after successful reads", async () => {
    api.listDataSources.mockResolvedValue([{ id: "source" }]);
    api.listSchedules.mockResolvedValue([{ id: "schedule", enabled: true }]);
    api.listWatchers.mockResolvedValue([]);
    mount();

    expect(await screen.findByText("1 source")).toBeTruthy();
    expect(screen.getByText("1/1 active")).toBeTruthy();
    expect(screen.getByText("0 watchers")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not present failed reads as zero and exposes an individual refresh action", async () => {
    api.listDataSources.mockRejectedValue(new Error("private query details"));
    api.listSchedules.mockResolvedValue([{ id: "schedule", enabled: true }]);
    api.listWatchers.mockResolvedValue([]);
    mount();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Unavailable counts are not zero");
    expect(screen.getAllByText("Unavailable")).toHaveLength(1);
    const refresh = screen.getByRole("button", { name: "Refresh data sources" });
    fireEvent.click(refresh);
    await waitFor(() => expect(api.listDataSources).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("private query details")).toBeNull();
  });
});
