// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReconStudioIndex } from "@/components/recon-studio-index";
import type { ReconListPageRow } from "@/lib/recons.functions";
import type { ResourceAccessSummary } from "@/lib/resource-access-summaries.functions";

const rows = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Cash vs ledger",
    recon_code: "FVI-GEN-2WAY-000001",
    description: "Daily cash",
    recon_type: "two_sided",
    status: "draft",
    sides: [],
    rules: [],
    updated_at: "2026-09-24T04:00:00Z",
    last_run_at: null,
    last_status: null,
    last_run_available: true,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Broker trades",
    recon_code: "FVI-GEN-3WAY-000002",
    description: "Trade control",
    recon_type: "three_sided",
    status: "active",
    sides: [{}, {}, {}],
    rules: [{}],
    updated_at: "2026-09-23T04:00:00Z",
    last_run_at: null,
    last_status: null,
    last_run_available: false,
  },
] as unknown as ReconListPageRow[];
const mappedAccess: ResourceAccessSummary = {
  resource_type: "reconciliation",
  resource_id: rows[0].id,
  public_id: "RPC-ALIAS",
  access_state: "mapped",
  business_unit_names: ["Treasury"],
  business_unit_count: 1,
  user_group_names: ["Risk"],
  user_group_count: 1,
};

function show(overrides: Partial<React.ComponentProps<typeof ReconStudioIndex>> = {}) {
  const props: React.ComponentProps<typeof ReconStudioIndex> = {
    rows,
    total: 400,
    page: 1,
    pageSize: 25,
    totalPages: 16,
    selectedIndex: 0,
    resourceAccessById: new Map(),
    resourceAccessAvailable: false,
    resourceAccessLoading: false,
    resourceActorById: new Map(),
    resourceActorAvailable: false,
    dataSourceNameById: new Map([["source-1", "Main Ledger"]]),
    retirementStatusById: new Map(),
    retirementStatusAvailable: false,
    searchInput: "",
    statusFilter: "all",
    typeFilter: "all",
    sortOrder: "updated_desc",
    updatedFrom: "",
    updatedThrough: "",
    updatedRangeInvalid: false,
    isLoading: false,
    isError: false,
    onSearchChange: vi.fn(),
    onStatusChange: vi.fn(),
    onTypeChange: vi.fn(),
    onSortChange: vi.fn(),
    onUpdatedFromChange: vi.fn(),
    onUpdatedThroughChange: vi.fn(),
    onPageChange: vi.fn(),
    onSelect: vi.fn(),
    onRetry: vi.fn(),
    renderSelectedActions: () => <button type="button">Processed runs</button>,
    ...overrides,
  };
  render(<ReconStudioIndex {...props} />);
  return props;
}

afterEach(cleanup);

describe("Recon Studio scale index", () => {
  it("shows real page metadata and distinguishes never from unavailable latest-run data", () => {
    show();
    expect(screen.getByRole("table", { name: "Reconciliations" })).toBeTruthy();
    const selectedRow = screen.getByRole("button", { name: "Select Cash vs ledger" }).closest("tr");
    expect(selectedRow?.className).toContain("fvi-selected-row");
    expect(selectedRow?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("1–25 of 400 · 25 per page")).toBeTruthy();
    expect(screen.getAllByText("Never").length).toBeGreaterThan(0);
    expect(screen.getByText("Unavailable")).toBeTruthy();
    const viewButton = screen.getByRole("button", { name: "View Cash vs ledger" });
    fireEvent.click(viewButton);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Needs setup")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Processed runs" })).toBeTruthy();
    expect(viewButton.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps search, row selection and pagination keyboard-operable", () => {
    const props = show();
    fireEvent.change(screen.getByPlaceholderText("Name, recon_code or description…"), {
      target: { value: "broker" },
    });
    expect(props.onSearchChange).toHaveBeenCalledWith("broker");
    fireEvent.click(screen.getByRole("button", { name: "Select Broker trades" }));
    expect(props.onSelect).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(props.onPageChange).toHaveBeenCalledWith(2);
  });

  it("wires UTC date filters and never presents stale rows for a reversed range", () => {
    const props = show();
    fireEvent.change(screen.getByLabelText("Updated from (UTC)"), {
      target: { value: "2026-05-03" },
    });
    fireEvent.change(screen.getByLabelText("Updated through (UTC)"), {
      target: { value: "2026-05-04" },
    });
    expect(props.onUpdatedFromChange).toHaveBeenCalledWith("2026-05-03");
    expect(props.onUpdatedThroughChange).toHaveBeenCalledWith("2026-05-04");
    cleanup();
    show({ updatedFrom: "2026-05-05", updatedThrough: "2026-05-04", updatedRangeInvalid: true });
    expect(screen.getByRole("alert").textContent).toContain(
      "Updated through must be on or after Updated from",
    );
    expect(screen.queryByRole("table", { name: "Reconciliations" })).toBeNull();
  });

  it("shows an unavailable read with retry instead of an empty or zero result", () => {
    const props = show({ rows: [], total: 0, isError: true });
    expect(screen.getByRole("alert").textContent).toContain("could not be loaded");
    expect(screen.queryByText("No reconciliations yet.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows Public ID and mapped business-unit and user-group names", () => {
    show({
      resourceAccessById: new Map([[rows[0].id, mappedAccess]]),
      resourceAccessAvailable: true,
    });
    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent?.trim());
    expect(headers.indexOf("Public ID")).toBeLessThan(headers.indexOf("Reconciliation"));
    expect(screen.getByRole("columnheader", { name: "Business units" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "User groups" })).toBeTruthy();
    expect(screen.getAllByText("FVI-GEN-2WAY-000001").length).toBeGreaterThan(0);
    expect(screen.queryByText("RPC-ALIAS")).toBeNull();
    expect(screen.getAllByText("Treasury").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Risk").length).toBeGreaterThan(0);
  });

  it("keeps unavailable summaries distinct from confirmed legacy unmapped records", () => {
    const props = show();
    expect(screen.getAllByText("Access mapping unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByText("Unassigned")).toBeNull();
    cleanup();
    show({
      ...props,
      rows: [rows[0]],
      total: 1,
      totalPages: 1,
      resourceAccessAvailable: true,
      resourceAccessById: new Map([
        [
          rows[0].id,
          {
            ...mappedAccess,
            access_state: "unmapped",
            business_unit_names: [],
            business_unit_count: 0,
            user_group_names: [],
            user_group_count: 0,
          },
        ],
      ]),
    });
    expect(screen.getAllByText("Unassigned").length).toBeGreaterThan(0);
    expect(screen.queryByText("Access mapping unavailable")).toBeNull();
  });

  it("opens the gold View dialog with sources, rule parameters, access, actors and gated actions; Escape restores focus", async () => {
    const detailRow = {
      ...rows[0],
      sides: [
        { side_id: "A", label: "Ledger", data_source_id: "source-1" },
        { side_id: "B", label: "Statement", data_source_id: "source-1" },
      ],
      rules: [
        {
          id: "rule-1",
          kind: "exact",
          description: "Match account identifiers",
          fields: { A: "account_no", B: "account_no" },
          params: { tolerance: 0.01, reference_table_id: "11111111-1111-4111-8111-111111111111" },
        },
      ],
    } as unknown as ReconListPageRow;
    const actorSummary = {
      resource_type: "reconciliation" as const,
      resource_id: detailRow.id,
      updated_by_label: "A. Editor",
      updated_by_status: "known" as const,
      created_by_label: "C. Creator",
      created_by_status: "known" as const,
    };
    show({
      rows: [detailRow],
      total: 1,
      totalPages: 1,
      resourceAccessById: new Map([[detailRow.id, mappedAccess]]),
      resourceAccessAvailable: true,
      resourceActorById: new Map([[detailRow.id, actorSummary]]),
      resourceActorAvailable: true,
      retirementStatusById: new Map([
        [detailRow.id, "Pending retirement request · independent decision needed"],
      ]),
      retirementStatusAvailable: true,
      renderSelectedActions: () => (
        <>
          <button type="button">Processed runs</button>
          <button type="button">Access</button>
          <button type="button">Edit</button>
          <button type="button">Versions</button>
        </>
      ),
    });
    const trigger = screen.getByRole("button", { name: "View Cash vs ledger" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(screen.getAllByText("Main Ledger").length).toBe(2);
    expect(screen.getByText("Match account identifiers")).toBeTruthy();
    expect(screen.getByText("tolerance")).toBeTruthy();
    expect(screen.getByText("0.01")).toBeTruthy();
    expect(screen.getByText("A. Editor")).toBeTruthy();
    expect(screen.getByText("C. Creator")).toBeTruthy();
    expect(
      screen.getByText("Lock state is not provided by this reconciliation record."),
    ).toBeTruthy();
    expect(screen.getByText(/Pending retirement request/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Processed runs" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Access" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Versions" })).toBeTruthy();
    expect(dialog.textContent).not.toContain("11111111-1111-4111-8111-111111111111");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("closes reconciliation details when opening the processed-runs workbench", () => {
    show({
      rows: [rows[1]],
      total: 1,
      totalPages: 1,
      renderSelectedActions: (_row, closeDetails) => (
        <button type="button" onClick={closeDetails}>
          Processed runs
        </button>
      ),
    });
    fireEvent.click(screen.getByRole("button", { name: "View Broker trades" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Processed runs" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows source-backed creator and editor labels when the list response provides them", () => {
    const row = rows[0];
    const summary = {
      resource_type: "reconciliation" as const,
      resource_id: row.id,
      updated_by_label: "A. Editor",
      updated_by_status: "known" as const,
      created_by_label: "C. Creator",
      created_by_status: "known" as const,
    };
    show({
      rows: [row],
      total: 1,
      totalPages: 1,
      resourceActorById: new Map([[row.id, summary]]),
      resourceActorAvailable: true,
    });
    expect(screen.getByText("by A. Editor")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View Cash vs ledger" }));
    expect(screen.getByText("C. Creator")).toBeTruthy();
    expect(screen.queryByText("Creator unavailable")).toBeNull();
  });
});
