// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { listRuns, listDefinitionRuns, getDetail } = vi.hoisted(() => ({
  listRuns: vi.fn(),
  listDefinitionRuns: vi.fn(),
  getDetail: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/recons.functions", () => ({ listRuns }));
vi.mock("@/lib/recon-run-detail.functions", () => ({
  listReconDefinitionRuns: listDefinitionRuns,
  getReconRunDetail: getDetail,
}));

import { RunHistoryTab } from "@/components/run-history-tab";

const tenantId = "11111111-1111-4111-8111-111111111111";
const definitionId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><RunHistoryTab tenantId={tenantId} /></QueryClientProvider>);
}

afterEach(() => { cleanup(); listRuns.mockReset(); listDefinitionRuns.mockReset(); getDetail.mockReset(); });

describe("workspace run history", () => {
  it("shows an accessible loading state while persisted runs are loading", () => {
    listRuns.mockReturnValue(new Promise(() => {}));
    show();
    expect(screen.getByRole("status").textContent).toContain("Loading recent run history");
  });

  it("opens the exact persisted run and distinguishes missing metrics from stored zero values", async () => {
    listRuns.mockResolvedValue([{
      id: runId,
      run_uid: "FVI-RUN-20260924-ABCD1234",
      definition_id: definitionId,
      status: "completed",
      matched_count: null,
      exception_count: 0,
      total_rows: null,
      started_at: "2026-09-24T04:00:00.000Z",
      completed_at: null,
      definition: { name: "Nostro close", recon_type: "two_sided" },
    }]);
    listDefinitionRuns.mockResolvedValue({ rows: [], count: 0, pageSize: 50 });
    getDetail.mockResolvedValue(null);
    show();

    const runButton = await screen.findByRole("button", { name: "Open run FVI-RUN-20260924-ABCD1234" });
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("0")).toBeTruthy();
    fireEvent.click(runButton);
    await waitFor(() => expect(listDefinitionRuns).toHaveBeenCalledWith({
      data: { tenant_id: tenantId, definition_id: definitionId, days: 7, page: 0 },
    }));
    expect(getDetail).toHaveBeenCalledWith({ data: { tenant_id: tenantId, run_id: runId, page: 0, status: "all" } });
    expect(screen.getByRole("button", { name: "Last 24 hours" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "7 days" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "14 days" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "30 days" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "90 days" })).toBeTruthy();
  });

  it("offers a retry for unavailable history and shows an honest empty state for an empty response", async () => {
    listRuns.mockRejectedValueOnce(new Error("private provider error")).mockResolvedValueOnce([]);
    show();
    expect(await screen.findByText("Run history is temporarily unavailable.")).toBeTruthy();
    expect(screen.queryByText("private provider error")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/No runs are available in this workspace yet/)).toBeTruthy();
  });
});
