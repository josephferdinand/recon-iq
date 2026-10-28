// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  from: vi.fn(),
  builders: [] as any[],
}));

const observedOptions: any[] = [];

vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  TabsTrigger: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
  TabsContent: ({ children, ...props }: any) => <section {...props}>{children}</section>,
}));
vi.mock("@/components/saved-views-bar", () => ({ SavedViewsBar: () => null }));
vi.mock("@/components/pivot-panel", () => ({
  PivotPanel: ({ totalLabel }: any) => <div data-testid="pivot-total-label">{totalLabel}</div>,
}));
vi.mock("@/components/break-grid-editor", () => ({
  BreakGridEditor: ({ title, initialRows }: any) => (
    <div data-testid="grid-sample">{title}{JSON.stringify(initialRows)}</div>
  ),
}));
vi.mock("@/components/document-split-viewer", () => ({
  DocumentSplitViewer: ({ pdfUrl, pdfUnavailableMessage, fields, break_ }: any) => (
    <div data-testid="document-viewer">
      <span>{pdfUrl ? "PDF available" : pdfUnavailableMessage}</span>
      <span>{fields.length} extracted fields</span>
      <span>{break_ ? "Related exception loaded" : "No related exception loaded"}</span>
    </div>
  ),
}));

import {
  normalizeProductivityExceptions,
  productivityExtractedFields,
  ProductivityTab,
} from "@/components/productivity-tab";

const exceptionResult = {
  data: [] as any[],
  isLoading: false,
  isFetching: false,
  isError: false,
  refetch: vi.fn(),
};
const documentResult = {
  data: null as any,
  isFetching: false,
  isError: false,
  refetch: vi.fn(),
};

describe("ProductivityTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    observedOptions.length = 0;
    Object.assign(exceptionResult, { data: [], isLoading: false, isFetching: false, isError: false });
    Object.assign(documentResult, { data: null, isFetching: false, isError: false });
    mocks.builders.length = 0;
    mocks.useQuery.mockImplementation((options: any) => {
      observedOptions.push(options);
      return options.queryKey[0] === "productivity-exceptions" ? exceptionResult : documentResult;
    });
    mocks.from.mockImplementation((table: string) => {
      const result = { data: table === "recon_exceptions" ? exceptionResult.data : null, error: null };
      const builder: any = { table, result };
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.order = vi.fn(() => builder);
      builder.limit = vi.fn(() => table === "aidp_documents" ? builder : Promise.resolve(result));
      builder.maybeSingle = vi.fn(() => Promise.resolve(result));
      mocks.builders.push(builder);
      return builder;
    });
  });

  afterEach(cleanup);

  it("normalizes malformed payload, amount and timestamp without fabricating zero metrics", () => {
    const rows = normalizeProductivityExceptions([
      null,
      {},
      {
        id: "internal-id",
        payload: { category: { unsafe: true }, amount: "not-a-number", currency: ["bad"] },
        status: null,
        severity: {},
        created_at: "not-a-date",
      },
      {
        id: "row-2",
        payload: { amount: 0, category: "Fees" },
        created_at: "2026-09-24T00:00:00.000Z",
      },
    ], Date.parse("2026-09-25T00:00:00.000Z"));

    expect(rows).toEqual([
      expect.objectContaining({
        status: "Unknown",
        severity: "Unknown",
        category: "Uncategorised",
        counterparty: "—",
        currency: "—",
        amount: null,
        age_days: null,
        assigned_to: "Unassigned",
      }),
      expect.objectContaining({ category: "Fees", amount: 0, age_days: 1 }),
    ]);
    expect(rows.some((row: any) => "id" in row)).toBe(false);
    expect(normalizeProductivityExceptions({ malformed: true })).toEqual([]);
    expect(normalizeProductivityExceptions([{
      created_at: "2026-09-26T00:00:00.000Z",
      payload: { amount: 1 },
    }], Date.parse("2026-09-25T00:00:00.000Z"))[0].age_days).toBeNull();
  });

  it("queries only the newest 500 tenant-filtered exceptions and checks the AIDP error result", async () => {
    render(<ProductivityTab tenantId="tenant-a" />);
    const exceptionQuery = observedOptions.find(({ queryKey }) => queryKey[0] === "productivity-exceptions");
    const documentQuery = observedOptions.find(({ queryKey }) => queryKey[0] === "productivity-latest-aidp");
    await exceptionQuery.queryFn();
    await documentQuery.queryFn();

    const exceptionBuilder = mocks.builders.find(({ table }) => table === "recon_exceptions");
    const documentBuilder = mocks.builders.find(({ table }) => table === "aidp_documents");
    expect(exceptionBuilder.select).toHaveBeenCalledWith("status, severity, priority, side, assignee, payload, created_at");
    expect(exceptionBuilder.eq).toHaveBeenCalledWith("tenant_id", "tenant-a");
    expect(exceptionBuilder.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(exceptionBuilder.limit).toHaveBeenCalledWith(500);
    expect(documentBuilder.eq).toHaveBeenCalledWith("tenant_id", "tenant-a");
    expect(documentBuilder.limit).toHaveBeenCalledWith(1);
    expect(documentBuilder.maybeSingle).toHaveBeenCalledOnce();
  });

  it("keeps extraction fields scalar-only and bounded", () => {
    const extraction = Object.fromEntries([
      ["vendor", "North"],
      ["total", 0],
      ["nested", { amount: 12 }],
      ["empty", null],
      ...Array.from({ length: 45 }, (_, index) => ["field-" + index, "value"]),
    ]);

    const fields = productivityExtractedFields(extraction);
    expect(fields).toHaveLength(40);
    expect(fields[0]).toEqual({ key: "vendor-0", label: "vendor", value: "North" });
    expect(fields.some((field) => field.label === "nested")).toBe(false);
  });

  it("states the loaded-row cap and does not generate a worksheet totals row", () => {
    documentResult.data = { doc: { original_filename: "statement.pdf", extraction: {} } };
    exceptionResult.data = [
      { status: "Open", severity: "Medium", category: "Fees", counterparty: "Bank A", currency: "USD", amount: null, age_days: null, assigned_to: "Unassigned" },
    ];
    render(<ProductivityTab tenantId="tenant-a" />);

    expect(screen.getByText(/newest 500 tenant-filtered exceptions/i)).toBeTruthy();
    expect(screen.getByTestId("pivot-total-label").textContent).toContain("Count of loaded rows");
    expect(screen.getByTestId("grid-sample").textContent).toContain("loaded sample");
    expect(screen.getByTestId("grid-sample").textContent).not.toContain("Totals");
    expect(screen.getByTestId("document-viewer").textContent).toContain("does not load a PDF preview link");
    expect(screen.getByTestId("document-viewer").textContent).toContain("No related exception loaded");
  });

  it("shows a safe retry state for query failures and a bounded empty state", () => {
    exceptionResult.isError = true;
    documentResult.isError = true;
    const { rerender } = render(<ProductivityTab tenantId="tenant-a" />);
    expect(screen.getByText(/Exception data could not be loaded/i)).toBeTruthy();
    expect(screen.getByText(/document details are temporarily unavailable/i)).toBeTruthy();
    expect(screen.queryByText(/secret|stack|database|uuid/i)).toBeNull();

    exceptionResult.isError = false;
    exceptionResult.data = [];
    documentResult.isError = false;
    rerender(<ProductivityTab tenantId="tenant-a" />);
    expect(screen.getByText(/no tenant-filtered exceptions were returned/i)).toBeTruthy();
    expect(screen.getByTestId("document-viewer").textContent).toContain("No source document was returned");

    fireEvent.click(screen.getByRole("button", { name: "Grid editor" }));
    expect(screen.getByText(/up to 20 rows from the loaded exception slice/i)).toBeTruthy();
  });
});
