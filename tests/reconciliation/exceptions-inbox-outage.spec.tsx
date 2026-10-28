// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const retry = vi.fn();
let mutationFailure: unknown = null;
let mutationCalls = 0;
let queueFailed = true;
let queuePending = false;
let queueEmpty = false;
let dashboardFailed = false;
const staleRows = [{
  id: "4a2d1a60-61cc-48b4-a650-e7e1786da31a",
  public_case_id: "FVI-EXC-ABCDEF0123456789ABCDEF0123456789",
  match_issue: { code: "missing_counterpart", label: "Missing counterpart" },
  reason: "Unmatched: no counterpart on side C for key internal-test-value",
  status: "open",
  lifecycle_state: "new",
  severity: "high",
  priority: "P1",
  assignee: null,
  due_date: "2026-09-23T18:00:00.000Z",
  root_cause: "Custodian file not received",
  created_at: "2026-09-23T10:00:00.000Z",
  run: { started_at: "2026-09-23T09:30:00.000Z", definition: { name: "Daily holdings" } },
  payload: { sides: [{ label: "Internal", row: { reference: "R-1" } }, { label: "Custodian", row: {} }] },
}];
const originalExceptionPayload = staleRows[0].payload;
const noRules: unknown[] = [];
let attachmentRows: Array<Record<string, unknown>> = [];
const dashboardData = {
  as_of: "2026-09-24T10:00:00.000Z",
  window_days: 30 as const,
  totals: { total: 23, open: 14, resolved: 9, high_priority: 1, unassigned: 3, older_than_30_days: 2, oldest_open_days: 41 },
  by_severity: [],
  by_status: [
    { name: "new", count: 6 }, { name: "assigned", count: 3 }, { name: "investigating", count: 4 },
    { name: "pending_counterparty", count: 1 }, { name: "resolved", count: 8 }, { name: "written_off", count: 1 },
  ],
  ageing: [
    { name: "0–2", count: 5 }, { name: "3–7", count: 4 }, { name: "8–30", count: 3 },
    { name: "31–90", count: 2 }, { name: "90+", count: 0 },
  ],
  trend: [],
  by_reconciliation: [],
};

vi.mock("@tanstack/react-start", () => ({ useServerFn: () => vi.fn() }));
vi.mock("@/lib/exception-dashboard.functions", () => ({ getExceptionDashboard: vi.fn() }));
vi.mock("@/lib/recons.functions", () => ({
  listExceptions: vi.fn(), resolveException: vi.fn(), bulkResolveExceptions: vi.fn(), escalateExceptionToTicket: vi.fn(),
}));
vi.mock("@/lib/break-manager.functions", () => ({ listBreaks: vi.fn(), listExceptionPage: vi.fn(), listComments: vi.fn(), listAttachments: vi.fn() }));
vi.mock("@/lib/nrl.functions", () => ({ listExceptionTransitions: vi.fn() }));
vi.mock("@/lib/members.functions", () => ({ listTenantMembers: vi.fn() }));
vi.mock("@/lib/assignment-rules.functions", () => ({ autoAssignExceptions: vi.fn(), listAssignmentRules: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: Array<string | number> }) => queryKey[0] === "exception-dashboard"
    ? { data: dashboardFailed ? undefined : dashboardData, isLoading: false, isPending: false, isError: dashboardFailed, isFetching: false, refetch: retry }
    : queryKey[0] === "recon-exceptions"
    ? { data: staleRows, isLoading: false, isPending: false, isError: queueFailed, refetch: retry }
    : queryKey[0] === "breaks"
      ? { data: queueEmpty ? { items: [], total: 0 } : { items: staleRows, total: staleRows.length }, isLoading: queuePending, isPending: queuePending, isError: queueFailed, refetch: retry }
      : queryKey[0] === "break-attachments"
        ? { data: attachmentRows, isLoading: false, isPending: false, isError: false, refetch: retry }
      : { data: noRules, isLoading: false, isPending: false, isError: false },
  useMutation: (options: { onError?: (error: unknown) => void }) => ({
    mutate: vi.fn(() => {
      mutationCalls += 1;
      if (mutationFailure !== null) options.onError?.(mutationFailure);
    }),
    isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), cancelQueries: vi.fn(), getQueryData: vi.fn(), setQueryData: vi.fn() }),
}));
vi.mock("@/components/saved-views", () => ({ SavedViews: () => null }));
vi.mock("@/components/mobile-triage", () => ({ MobileTriage: () => null }));
vi.mock("@/hooks/use-keyboard-shortcuts", () => ({ useKeyboardShortcuts: () => undefined }));
vi.mock("@/components/keyboard-shortcuts-dialog", () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: () => null,
  DropdownMenuItem: () => null,
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { ExceptionsTab } from "@/components/exceptions-tab";

afterEach(() => { cleanup(); retry.mockClear(); queueFailed = true; queuePending = false; queueEmpty = false; dashboardFailed = false; attachmentRows = []; mutationFailure = null; mutationCalls = 0; staleRows[0].due_date = "2026-09-23T18:00:00.000Z"; staleRows[0].payload = originalExceptionPayload; });

describe("Exceptions inbox outage", () => {
  it("shows a retryable unavailable state instead of stale breaks or an empty queue", () => {
    render(<ExceptionsTab tenantId="tenant-a" canWrite />);
    expect(screen.getByRole("alert").textContent).toContain("Exception queue unavailable");
    expect(screen.queryByText("Stale break")).toBeNull();
    expect(screen.queryByText("Nothing to triage")).toBeNull();
    expect((screen.getByRole("button", { name: "Export current page" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("keeps filtered loading distinct from a confirmed empty result", () => {
    queueFailed = false;
    queuePending = true;
    render(<ExceptionsTab tenantId="tenant-a" canWrite />);
    expect(screen.queryByText("Nothing to triage")).toBeNull();
    expect(screen.getByLabelText("Loading exceptions")).toBeTruthy();
  });

  it("shows a filter-aware empty state only after the queue confirms zero matching cases", () => {
    queueFailed = false;
    queueEmpty = true;
    render(<ExceptionsTab tenantId="tenant-a" canWrite />);
    expect(screen.getByText("Nothing to triage")).toBeTruthy();
    expect(screen.getByText("No exceptions match the current filters. Clear a filter or search term and try again.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Recorded due dates for this page" })).toBeNull();
  });

  it("keeps queue status and workflow stage distinct and shows persisted selected-case context", () => {
    queueFailed = false;
    render(<ExceptionsTab tenantId="tenant-a" canWrite />);
    expect(screen.getByText((_, el) => el?.textContent === "Queue · Open")).toBeTruthy();
    expect(screen.getByText((_, el) => el?.textContent === "Workflow · New")).toBeTruthy();
    expect(screen.getByText("Unassigned", { exact: true })).toBeTruthy();
    expect(screen.getByText("Page 1 of 1")).toBeTruthy();
    expect(screen.getByText("Select a case to inspect")).toBeTruthy();
    expect(screen.queryByText(staleRows[0].id)).toBeNull();

    fireEvent.click(screen.getAllByText("Missing counterpart")[0]);
    expect(screen.getByText(/Exception details · FVI-EXC-/u)).toBeTruthy();
    expect(screen.getByText((_, el) => el?.textContent === "Match issue · Missing counterpart")).toBeTruthy();
    expect(screen.getAllByText("FVI-EXC-ABCDEF0123456789ABCDEF0123456789")).toHaveLength(2);
    expect(screen.queryByText(/internal-test-value/u)).toBeNull();
    expect(screen.getAllByText("Custodian file not received")).toHaveLength(2);
    expect(screen.getByText("No comments recorded.")).toBeTruthy();
    expect(screen.getByText("No attachments recorded.")).toBeTruthy();
    expect(screen.getByText("No workflow activity recorded.")).toBeTruthy();
  });

  it("renders persisted multi-member match groups side by side instead of raw payload JSON", () => {
    queueFailed = false;
    staleRows[0].payload = {
      key: "account_ref=QA-CASH-02|transaction_id=QA-DUP-002",
      sums: { SOURCE_A: "50.20", SOURCE_B: "25.10" },
      members: {
        SOURCE_A: [
          { amount: "25.10", qa_case: "QA-DUPLICATE", account_ref: "QA-CASH-02", transaction_id: "QA-DUP-002" },
          { amount: "25.10", qa_case: "QA-DUPLICATE", account_ref: "QA-CASH-02", transaction_id: "QA-DUP-002" },
        ],
        SOURCE_B: [{ amount: "25.10", qa_case: "QA-DUPLICATE", account_ref: "QA-CASH-02", transaction_id: "QA-DUP-002" }],
      },
      tolerance: 0.01,
    } as unknown as typeof staleRows[0]["payload"];
    render(<ExceptionsTab tenantId="tenant-a" canWrite />);
    fireEvent.click(screen.getAllByText("Missing counterpart")[0]);

    expect(screen.getByRole("columnheader", { name: "SOURCE_A · 2 records" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "SOURCE_B" })).toBeTruthy();
    expect(screen.getAllByText("QA-DUPLICATE")).toHaveLength(3);
    expect(screen.getAllByText("25.10").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByRole("pre")).toBeNull();
  });

  it("validates ticket subjects and blocks blind retries after an uncertain write", () => {
    queueFailed = false;
    render(<ExceptionsTab tenantId="tenant-a" canWrite />);
    fireEvent.click(screen.getByRole("button", { name: /^Escalate .*to ticket$/u }));
    const subject = screen.getByLabelText("Subject") as HTMLInputElement;
    fireEvent.change(subject, { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
    expect(screen.getByText("Correct the highlighted field to continue.")).toBeTruthy();
    expect(screen.getAllByText((_, element) => element?.id === "exception-ticket-subject-error")).toHaveLength(1);
    expect(subject.getAttribute("aria-invalid")).toBe("true");
    expect(mutationCalls).toBe(0);

    mutationFailure = new Error("Network request failed");
    fireEvent.change(subject, { target: { value: "Review cash variance" } });
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
    expect(screen.getByRole("button", { name: "Check the exception queue before retrying" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Create ticket" }) as HTMLButtonElement).disabled).toBe(true);
    expect(subject.value).toBe("Review cash variance");
    expect(screen.queryByText("Network request failed")).toBeNull();
    expect(mutationCalls).toBe(1);
  });

  it("shows full-population workflow counts and open-age buckets beside the paged table", () => {
    queueFailed = false;
    render(<ExceptionsTab tenantId="tenant-a" canWrite />);
    expect(screen.getByText("Authorized scope · all visible runs")).toBeTruthy();
    expect(screen.getByText("Age of open exceptions")).toBeTruthy();
    expect(screen.getByRole("img", { name: /Open exception ages: 0–2 days: 5, 3–7 days: 4/u })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Match issue" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Queue / workflow" })).toBeTruthy();
    expect(screen.getByText(/1d$/u)).toBeTruthy();
    expect(screen.getByText(/Due date passed/u)).toBeTruthy();
    expect(screen.getByText(/SLA timer status is not part/u)).toBeTruthy();
    const deadlineSummary = within(screen.getByRole("region", { name: "Recorded due dates for this page" }));
    expect(deadlineSummary.getByText("Recorded due dates · current page")).toBeTruthy();
    expect(deadlineSummary.getByText("A passed due date is not confirmation of an SLA breach.")).toBeTruthy();
    expect(deadlineSummary.getByText("Passed").parentElement?.querySelector("dd")?.textContent).toBe("1");
  });

  it("keeps the queue visible and deadline status unknown when aggregate timing data fails", () => {
    queueFailed = false;
    dashboardFailed = true;
    render(<ExceptionsTab tenantId="tenant-a" canWrite />);
    expect(screen.getByText("Exception overview unavailable")).toBeTruthy();
    expect(screen.queryByText("Exception queue unavailable")).toBeNull();
    const deadlineSummary = within(screen.getByRole("region", { name: "Recorded due dates for this page" }));
    expect(deadlineSummary.getByText("Status unavailable").parentElement?.querySelector("dd")?.textContent).toBe("1");
    expect(screen.getByText(/state unavailable/u)).toBeTruthy();
  });

  it("shows safe persisted attachment metadata without exposing storage paths", () => {
    queueFailed = false;
    attachmentRows = [{
      id: "attachment-1",
      filename: "custodian-statement.pdf",
      mime_type: "application/pdf",
      size_bytes: 1536,
      storage_path: "private/tenant-internal/path.pdf",
      created_at: "2026-09-24T09:45:00.000Z",
      uploader_id: "4a2d1a60-61cc-48b4-a650-e7e1786da31a",
    }];
    render(<ExceptionsTab tenantId="tenant-a" canWrite />);
    fireEvent.click(screen.getAllByText("Missing counterpart")[0]);
    expect(screen.getByText("custodian-statement.pdf")).toBeTruthy();
    expect(screen.getByText(/application\/pdf · 1\.5 KB/u)).toBeTruthy();
    expect(screen.getByText(/Added by a team member/u)).toBeTruthy();
    expect(screen.queryByText(/private\/tenant-internal/u)).toBeNull();
    expect(screen.queryByText("4a2d1a60-61cc-48b4-a650-e7e1786da31a")).toBeNull();
  });
});
