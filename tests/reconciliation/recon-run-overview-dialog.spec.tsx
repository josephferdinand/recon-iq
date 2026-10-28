// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { listRuns, getDetail } = vi.hoisted(() => ({ listRuns: vi.fn(), getDetail: vi.fn() }));

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/recon-run-detail.functions", () => ({
  listReconDefinitionRuns: listRuns,
  getReconRunDetail: getDetail,
}));
vi.mock("recharts", async () => {
  const React = await import("react");
  const passthrough = ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement("div", props, children);
  return {
    ResponsiveContainer: passthrough,
    LineChart: passthrough,
    CartesianGrid: () => null,
    Legend: () => null,
    Line: () => null,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

import { ReconRunDetailWorkbench } from "@/components/recon-run-detail-dialog";

const tenantId = "11111111-1111-4111-8111-111111111111";
const definitionId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const periodRun = {
  id: runId,
  run_uid: "FVI-RUN-20260924-ABCD1234",
  definition_id: definitionId,
  status: "completed",
  total_rows: 17,
  matched_count: 2,
  exception_count: 7,
  matched_input_memberships: 8,
  started_at: "2026-09-24T04:00:00.000Z",
  completed_at: "2026-09-24T04:04:00.000Z",
};

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReconRunDetailWorkbench
        tenantId={tenantId}
        selection={{ definitionId, runId }}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  listRuns.mockReset();
  getDetail.mockReset();
});

describe("process-specific run overview", () => {
  it("shows an accessible loading state while period history is being read", () => {
    listRuns.mockReturnValue(new Promise(() => {}));
    getDetail.mockResolvedValue(null);
    show();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "History" }), { button: 0 });
    expect(screen.getByRole("status").textContent).toContain("Loading run history");
  });

  it("shows persisted period trend grains and marks unavailable historical metadata honestly", async () => {
    listRuns.mockResolvedValue({
      rows: [periodRun],
      count: 1,
      completedCount: 1,
      completedRuns: [periodRun],
      pageSize: 50,
    });
    getDetail.mockResolvedValue({
      run: {
        ...periodRun,
        definition_snapshot: {
          name: "Assurance S5",
          sides: [
            { side_id: "A", label: "Internal (Book of Record)" },
            { side_id: "B", label: "Broker (Execution Feed)" },
            { side_id: "C", label: "Custodian (Position Feed)" },
          ],
          sources: [
            { side_id: "A", name: "Internal Ledger" },
            { side_id: "B", name: "Broker Feed" },
            { side_id: "C", name: "Custodian Feed" },
          ],
        },
        definition: { name: "Assurance S5", recon_type: "three_sided", sides: [] },
      },
      matchCount: 2,
      exceptionCount: 7,
      pageSize: 50,
      matches: [],
      exceptions: [],
    });
    show();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Overview" }), { button: 0 });

    expect(await screen.findByText("Completed runs in period")).toBeTruthy();
    expect(screen.getByText("Latest completed input rows · all sides")).toBeTruthy();
    expect(screen.getByText("Latest completed matched groups")).toBeTruthy();
    expect(screen.getByText("Latest completed exception items")).toBeTruthy();
    expect(screen.getByText(/Matched input-row memberships: 8/)).toBeTruthy();
    expect(screen.getByText(/distinct matched input rows: N\/A/)).toBeTruthy();
    expect(
      screen.getByRole("img", {
        name: /Trend of matched groups and exception items across 1 latest completed runs/,
      }),
    ).toBeTruthy();
    expect(screen.getByText("A: Internal (Book of Record)")).toBeTruthy();
    expect(screen.getByText(/submission timestamps are not recorded/)).toBeTruthy();
    expect(screen.getByText(/does not record a version identifier/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "30 days" }));
    await waitFor(() =>
      expect(listRuns).toHaveBeenCalledWith({
        data: { tenant_id: tenantId, definition_id: definitionId, days: 30, page: 0 },
      }),
    );
    expect(await screen.findByText("Period overview · Last 30 days")).toBeTruthy();
  });

  it("keeps provider details out of the UI and retries to an honest empty period state", async () => {
    listRuns.mockRejectedValueOnce(new Error("private provider error")).mockResolvedValueOnce({
      rows: [],
      count: 0,
      completedCount: 0,
      completedRuns: [],
      pageSize: 50,
    });
    getDetail.mockResolvedValue(null);
    show();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "History" }), { button: 0 });

    expect(await screen.findByText("Run history is temporarily unavailable.")).toBeTruthy();
    expect(screen.queryByText("private provider error")).toBeNull();
    fireEvent.click(
      within(screen.getByRole("tabpanel", { name: "History" })).getByRole("button", {
        name: "Try again",
      }),
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Overview" }), { button: 0 });
    expect(
      await screen.findByText(
        "No completed runs in this period. Choose a longer period to include older completed runs.",
      ),
    ).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "History" }), { button: 0 });
    expect(
      screen.getByText("No runs started in this period. Choose a longer period to see older runs."),
    ).toBeTruthy();
  });
});
