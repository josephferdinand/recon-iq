// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { listRuns, getDetail } = vi.hoisted(() => ({ listRuns: vi.fn(), getDetail: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/recon-run-detail.functions", () => ({ listReconDefinitionRuns: listRuns, getReconRunDetail: getDetail }));

import { ReconRunDetailWorkbench } from "@/components/recon-run-detail-dialog";

const tenantId = "11111111-1111-4111-8111-111111111111";
const definitionId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const run = { id: runId, run_uid: "FVI-RUN-OLD", definition_id: definitionId, status: "completed", total_rows: 52, definition: { name: "Nostro", recon_type: "two_sided", sides: [{ side_id: "A" }, { side_id: "B" }] } };

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ReconRunDetailWorkbench tenantId={tenantId} selection={{ definitionId, runId }} onClose={() => {}} /></QueryClientProvider>);
}

afterEach(() => { cleanup(); listRuns.mockReset(); getDetail.mockReset(); });

describe("processed run presentation", () => {
  it("opens an exact run outside the history period and stacks A/B values in each field cell", async () => {
    listRuns.mockResolvedValue({ rows: [], count: 0, pageSize: 50 });
    getDetail.mockImplementation(async ({ data }: { data: { run_id: string; page: number } }) => ({
      run, parentCount: 52, hasNext: data.page === 0, pageSize: 50, fieldNames: ["reference", "amount", "historical_only"],
      statusCounts: { match_groups: 51, exception_items: 1, exception_buckets: { missing: 1 } },
      results: data.page === 0 ? [
        { kind: "match", id: "match-0", cardinality: "1:1", rule_id: "reference", members: { A: [{ reference: "LEFT", amount: 100 }], B: [{ reference: "RIGHT", amount: 100 }] } },
        { kind: "exception", id: "exception", status_bucket: "missing", members: { A: [{ reference: "BREAK" }] }, exception_items: [{ id: "exception-item", side: "A", reason: "Unmatched", status: "open", payload: { row: { reference: "BREAK" } } }] },
      ] : [{ kind: "match", id: "match-1", cardinality: "1:1", rule_id: "reference", members: { B: [{ reference: "LAST-PAGE" }], LEGACY: [{ reference: "OLDER-SIDE" }] } }],
    }));
    show();
    await waitFor(() => expect(screen.getByText("Run ID FVI-RUN-OLD")).toBeTruthy());
    expect(screen.getByRole("tab", { name: "Results" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Input rows · all sides").parentElement?.textContent).toContain("52");
    expect(screen.getAllByText("Matched groups")[0]?.parentElement?.textContent).toContain("51");
    expect(screen.getByRole("tab", { name: "Overview" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "History" })).toBeTruthy();
    expect(getDetail).toHaveBeenCalledWith({ data: { tenant_id: tenantId, run_id: runId, page: 0, status: "all" } });
    expect(screen.getByRole("columnheader", { name: "reference" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "amount" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "historical_only" })).toBeTruthy();
    expect(screen.getByText("LEFT")).toBeTruthy();
    expect(screen.getByText("RIGHT")).toBeTruthy();
    expect(screen.getByText("LEFT").closest("td")).toBe(screen.getByText("RIGHT").closest("td"));
    expect(screen.getByText("Different values")).toBeTruthy();
    expect(screen.getByText("Same value")).toBeTruthy();
    expect(screen.getByText("BREAK")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show full records for group 1" }));
    expect(screen.getByRole("button", { name: "Hide full records for group 1" })).toBeTruthy();
    expect(screen.getByText(/Side A \(A\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next records" }));
    await waitFor(() => expect(screen.getByText("LAST-PAGE")).toBeTruthy());
    expect(screen.getByRole("columnheader", { name: "reference" })).toBeTruthy();
    expect(screen.getByText(/OLDER-SIDE/)).toBeTruthy();
    expect(screen.getByText(/OLDER-SIDE/).closest("td")).toBe(screen.getByText("LAST-PAGE").closest("td"));
    expect(getDetail).toHaveBeenCalledWith({ data: { tenant_id: tenantId, run_id: runId, page: 1, status: "all" } });
  });

  it("shows three sided and 1:N constituent values in one grouped row with missing cues", async () => {
    listRuns.mockResolvedValue({ rows: [], count: 0, pageSize: 50 });
    getDetail.mockResolvedValue({
      run: { ...run, definition_snapshot: { name: "Tri-party", sides: [{ side_id: "A", label: "Internal" }, { side_id: "B", label: "Broker" }, { side_id: "C", label: "Custodian" }] } },
      parentCount: 1, hasNext: false, pageSize: 50, statusCounts: { match_groups: 1, exception_items: 0, exception_buckets: {} },
      results: [{ kind: "match", id: "group-1", cardinality: "2:1:1", rule_id: "amount", members: {
        A: [{ account: "A-ONE", amount: 40, trade_date: "2026-09-24", reference: "A-REF-1" }, { account: "A-TWO", amount: 60, trade_date: "2026-09-24", reference: "A-REF-2" }],
        B: [{ account: "B-ONE", amount: 100, trade_date: "2026-09-24", reference: "B-REF" }],
        C: [{ account: "C-ONE", trade_date: "2026-09-24", reference: "C-REF" }],
      } }],
    });
    show();
    await waitFor(() => expect(screen.getByText("A-ONE")).toBeTruthy());
    const accountCell = screen.getByText("A-ONE").closest("td");
    expect(accountCell).toBe(screen.getByText("A-TWO").closest("td"));
    expect(accountCell).toBe(screen.getByText("B-ONE").closest("td"));
    expect(accountCell).toBe(screen.getByText("C-ONE").closest("td"));
    expect(accountCell?.textContent).toContain("A1");
    expect(accountCell?.textContent).toContain("A2");
    expect(screen.getByText("Missing value")).toBeTruthy();
    for (const field of ["account", "amount", "trade_date", "reference"]) expect(screen.getByRole("columnheader", { name: field })).toBeTruthy();
    for (const value of ["40", "60", "100", "A-REF-1", "A-REF-2", "B-REF", "C-REF"]) expect(screen.getByText(value)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Tri-party" })).toBeTruthy();
  });

  it("renders shared-key missing-side items in one parent row and preserves each workflow child", async () => {
    listRuns.mockResolvedValue({ rows: [], count: 0, pageSize: 50 });
    getDetail.mockResolvedValue({
      run: { ...run, definition_snapshot: { name: "Tri-party", sides: [{ side_id: "A", label: "Internal" }, { side_id: "B", label: "Broker" }, { side_id: "C", label: "Custodian" }] } },
      results: [{ kind: "exception", id: "missing:shared", status_bucket: "missing", members: { A: [{ account: "A-ROW" }], B: [{ account: "B-ROW" }] }, exception_items: [
        { id: "exc-A", side: "A", reason: "Unmatched: no counterpart on side C", status: "open", payload: { key: "reference=SHARED", missing_sides: ["C"], row: { account: "A-ROW" } } },
        { id: "exc-B", side: "B", reason: "Unmatched: no counterpart on side C", status: "investigating", payload: { key: "reference=SHARED", missing_sides: ["C"], row: { account: "B-ROW" } } },
      ] }],
      parentCount: 1, hasNext: false, pageSize: 50,
      statusCounts: { match_groups: 0, exception_items: 2, exception_buckets: { missing: 2, partial: 0, duplicate: 0, invalid_key: 0, other: 0, unavailable: 0 } },
    });
    show();
    await waitFor(() => expect(screen.getByText("A-ROW")).toBeTruthy());
    expect(screen.getByText("B-ROW").closest("td")).toBe(screen.getByText("A-ROW").closest("td"));
    expect(screen.getByRole("button", { name: "Missing 2" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Inspect Missing exception group" }));
    expect(screen.getByText(/Exception item 1 · A · open/)).toBeTruthy();
    expect(screen.getByText(/Exception item 2 · B · investigating/)).toBeTruthy();
    expect(screen.queryByText("exc-A")).toBeNull();
    expect(screen.queryByText("exc-B")).toBeNull();
    expect(screen.getByRole("button", { name: "Inspect Missing exception group" }).closest("tr")?.className).toContain("fvi-selected-row");
  });

  it("shows persisted public case identity and recorded time with a copy affordance", async () => {
    listRuns.mockResolvedValue({ rows: [], count: 0, pageSize: 50 });
    getDetail.mockResolvedValue({
      run,
      results: [{ kind: "exception", id: "exception-parent", status_bucket: "missing", members: { A: [{ reference: "R-1" }] }, exception_items: [
        { id: "internal-row-id", public_case_id: "FVI-EXC-0123456789ABCDEF0123456789ABCDEF", side: "A", reason: "Unmatched", status: "open", created_at: "2026-09-24T11:12:13.000Z", payload: { row: { reference: "R-1" } } },
      ] }],
      parentCount: 1, hasNext: false, pageSize: 50,
      statusCounts: { match_groups: 0, exception_items: 1, exception_buckets: { missing: 1 } },
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    show();
    await waitFor(() => expect(screen.getByText("R-1")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Inspect Missing exception group" }));

    expect(screen.getByText("FVI-EXC-0123456789ABCDEF0123456789ABCDEF")).toBeTruthy();
    expect(screen.getByText(/Recorded \(UTC\):/).textContent).toContain("2026");
    expect(screen.getByText(/Source arrival timestamps and record-level ingest lineage are unavailable/)).toBeTruthy();
    expect(screen.getByText(/Workflow actions are not available from this read-only run-results service/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy case ID" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Public case ID copied"));
    expect(writeText).toHaveBeenCalledWith("FVI-EXC-0123456789ABCDEF0123456789ABCDEF");
  });

  it("filters page records by persisted match and exception evidence without treating exception workflow status as a result status", async () => {
    listRuns.mockResolvedValue({ rows: [], count: 0, pageSize: 50 });
    const results = [
        { kind: "match", id: "matched", cardinality: "1:1", rule_id: "key_match", members: { A: [{ id: "A-1" }], B: [{ id: "B-1" }] } },
        ...[
          ["missing", "missing", "A", "Unmatched", "open", { row: { id: "M-1" } }],
          ["partial", "partial", "A/B", "Rule failed", "resolved", { key: "k1", rule_id: "amount", sides: { A: { id: "P-A" }, B: { id: "P-B" } } }],
          ["duplicate", "duplicate", "A", "Validation failed", "open", { row: { id: "D-1" }, rule_kind: "unique" }],
          ["keyless", "invalid_key", "B", "Invalid or missing reconciliation key", "open", { row: { id: "K-1" } }],
          ["other-1", "other", "A", "Validation failed", "open", { row: { id: "O-1" }, rule_kind: "required" }],
          ["other-2", "other", "—", "Legacy exception", "open", { legacy: true }],
          ["unavailable", "unavailable", "—", "No persisted classification", "open", {}],
        ].map(([id, bucket, side, reason, status, payload]) => ({ kind: "exception", id, status_bucket: bucket, members: {}, exception_items: [{ id: `item-${id}`, side, reason, status, payload }] })),
      ];
    getDetail.mockImplementation(async ({ data }: { data: { status: string } }) => ({
      run, parentCount: 8, hasNext: false, pageSize: 50,
      statusCounts: { match_groups: 1, exception_items: 7, exception_buckets: { partial: 1, missing: 1, duplicate: 1, invalid_key: 1, other: 2, unavailable: 1 } },
      results: data.status === "all" ? results : results.filter((row) => row.kind === "exception" ? row.status_bucket === data.status : data.status === "match"),
    }));
    show();
    await waitFor(() => expect(screen.getByRole("navigation", { name: "Run result status filter" })).toBeTruthy());
    expect(screen.getByText("Whole-run counts")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Match 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Partial 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Missing 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Duplicate 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Invalid key 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Other exception 2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Status unavailable 1" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Run results" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Partial 1" }));
    await waitFor(() => expect(screen.getByText("Rule failed")).toBeTruthy());
    expect(screen.queryByText("Unmatched")).toBeNull();
    expect(screen.getByText("resolved")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate 1" }));
    await waitFor(() => expect(screen.getByText("Validation failed")).toBeTruthy());
    expect(screen.queryByText("resolved")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Invalid key 1" }));
    await waitFor(() => expect(screen.getByText("Invalid or missing reconciliation key")).toBeTruthy());
    expect(screen.queryByText("Unmatched")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Inspect Invalid key exception group" }));
    expect(screen.getByRole("complementary", { name: "Selected result details" })).toBeTruthy();
    expect(screen.getAllByText("K-1")).toHaveLength(1);
    expect(screen.getByText(/Public case ID unavailable in this run result/)).toBeTruthy();
    expect(screen.getByText(/Source arrival timestamps and record-level ingest lineage are unavailable/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close selected result details" }));
    expect(screen.queryByRole("complementary", { name: "Selected result details" })).toBeNull();
  });
});
