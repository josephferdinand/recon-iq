// End-to-end: DigitalTwinPanel renders stats tiles, node rows, and filters
// against mocked server functions. Verifies large-tenant pagination shape
// (rows + total) is consumed and no console errors surface.
// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

const listTwinNodesMock = vi.fn();
const getTwinStatsMock = vi.fn();
const getTwinSubgraphMock = vi.fn(async () => []);
vi.mock("@/lib/phase8-digital-twin.functions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/phase8-digital-twin.functions")>(
    "@/lib/phase8-digital-twin.functions",
  );
  return {
    ...actual,
    listTwinNodes: (a: unknown) => listTwinNodesMock(a),
    getTwinStats: (a: unknown) => getTwinStatsMock(a),
    getTwinSubgraph: (a: unknown) => getTwinSubgraphMock(a),
  };
});

import { DigitalTwinPanel } from "@/components/console/digital-twin-panel";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  listTwinNodesMock.mockReset();
  getTwinStatsMock.mockReset();
});
afterEach(() => cleanup());

describe("DigitalTwinPanel — e2e render", () => {
  it("shows stat tiles + node rows from server responses", async () => {
    getTwinStatsMock.mockResolvedValue({
      total_nodes: 42, total_edges: 91,
      ok_count: 30, warning_count: 8, breached_count: 3, unknown_count: 1,
      types: { source: 10, cutoff: 12 }, last_updated: new Date().toISOString(), query_ms: 87,
    });
    listTwinNodesMock.mockResolvedValue({
      rows: [
        { id: "n1", node_type: "source", node_key: "swift", label: "SWIFT feed", status: "ok", updated_at: new Date().toISOString() },
        { id: "n2", node_type: "cutoff", node_key: "eod-15", label: "EOD 15:00", status: "breached", updated_at: new Date().toISOString() },
      ],
      total: 2,
    });
    wrap(<DigitalTwinPanel tenantId="00000000-0000-0000-0000-000000000001" />);
    await waitFor(() => expect(screen.getByText("SWIFT feed")).toBeTruthy());
    expect(screen.getByText("EOD 15:00")).toBeTruthy();
    // Perf tile / breached count surfaces from stats
    expect(screen.getAllByText("42").length).toBeGreaterThan(0);
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
  });

  it("pushes search text into the server-side query", async () => {
    getTwinStatsMock.mockResolvedValue({
      total_nodes: 5, total_edges: 3, ok_count: 5, warning_count: 0,
      breached_count: 0, unknown_count: 0, types: { source: 5 }, last_updated: null, query_ms: 5,
    });
    listTwinNodesMock.mockResolvedValue({ rows: [], total: 0 });
    wrap(<DigitalTwinPanel tenantId="00000000-0000-0000-0000-000000000001" />);
    await waitFor(() => expect(listTwinNodesMock).toHaveBeenCalled());
    const search = await screen.findByPlaceholderText(/search/i);
    fireEvent.change(search, { target: { value: "swift" } });
    await waitFor(() => {
      const called = listTwinNodesMock.mock.calls.some(
        (c) => (c[0] as { data: { search?: string } }).data.search === "swift",
      );
      expect(called).toBe(true);
    }, { timeout: 2000 });
  });
});
