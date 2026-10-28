// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockApis = vi.hoisted(() => ({
  listManual: vi.fn(),
  decideManual: vi.fn(),
  listEod: vi.fn(),
  prepareEod: vi.fn(),
  approveEod: vi.fn(),
  computeAgeing: vi.fn(),
  listAgeing: vi.fn(),
  listTickets: vi.fn(),
  getTicket: vi.fn(),
  createTicket: vi.fn(),
  addTicketMessage: vi.fn(),
  updateTicket: vi.fn(),
  escalateTicket: vi.fn(),
  listSla: vi.fn(),
  upsertSla: vi.fn(),
  exportTicketAudit: vi.fn(),
  listAssignableUsers: vi.fn(),
  listTicketFilterOptions: vi.fn(),
  listKnowledge: vi.fn(),
  getArticle: vi.fn(),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/lib/manual-match-approvals.functions", () => ({
  listManualMatchApprovals: mockApis.listManual,
  decideManualMatch: mockApis.decideManual,
}));
vi.mock("@/lib/batch-bc.functions", () => ({
  listEodSignoffs: mockApis.listEod,
  prepareEodSignoff: mockApis.prepareEod,
  approveEodSignoff: mockApis.approveEod,
  computeAgeing: mockApis.computeAgeing,
  listAgeing: mockApis.listAgeing,
}));
vi.mock("@/components/substantiation-drawer", () => ({ SubstantiationDrawer: () => null }));
vi.mock("@/lib/tickets.functions", () => ({
  listTickets: mockApis.listTickets,
  getTicket: mockApis.getTicket,
  createTicket: mockApis.createTicket,
  addTicketMessage: mockApis.addTicketMessage,
  updateTicket: mockApis.updateTicket,
  escalateTicket: mockApis.escalateTicket,
  listSla: mockApis.listSla,
  upsertSla: mockApis.upsertSla,
  TICKET_CATEGORIES: ["general_question"],
  exportTicketAuditCsv: mockApis.exportTicketAudit,
  listAssignableUsers: mockApis.listAssignableUsers,
  listTicketFilterOptions: mockApis.listTicketFilterOptions,
}));
vi.mock("@/lib/kb-reader.functions", () => ({
  navigatorHubData: mockApis.listKnowledge,
  getKbArticleBySlug: mockApis.getArticle,
}));

import { ManualMatchApprovalsTab } from "@/components/manual-match-approvals-tab";
import { EodSignoffTab } from "@/components/ageing-eod-tabs";
import { TicketsTab } from "@/components/tickets-tab";
import { NavigatorHub } from "@/components/navigator-hub";
import { safeActionErrorMessage } from "@/components/query-error-feedback";

const tenantId = "22222222-2222-4222-8222-222222222222";

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  for (const fn of Object.values(mockApis)) fn.mockReset();
  mockApis.listManual.mockResolvedValue([]);
  mockApis.listEod.mockResolvedValue([]);
  mockApis.listTickets.mockResolvedValue([]);
  mockApis.listTicketFilterOptions.mockResolvedValue({ assignees: [], creators: [] });
  mockApis.listKnowledge.mockResolvedValue({ articles: [], categories: [] });
  mockApis.getArticle.mockResolvedValue(null);
});

afterEach(cleanup);

describe("Workspace Tasks & Approvals and Support safe-state contracts", () => {
  it("shows a real manual-approval empty state only after a successful read", async () => {
    wrap(<ManualMatchApprovalsTab tenantId={tenantId} />);
    expect(await screen.findByText("No pending manual matches.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows permission denial for EOD without calling it an empty queue or exposing provider detail", async () => {
    mockApis.listEod.mockRejectedValue(Object.assign(
      new Error("permission denied for table eod_signoffs"),
    ));
    wrap(<EodSignoffTab tenantId={tenantId} canWrite={false} />);
    expect(await screen.findByText("You Don't Currently Have Access")).toBeTruthy();
    expect(screen.queryByText("No sign-offs yet.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Prepare sign-off" })).toBeNull();
    expect(screen.queryByText(/permission denied|PGRST002|eod_signoffs/)).toBeNull();
  });

  it("surfaces a ticket-list outage with retry and does not claim no matches", async () => {
    mockApis.listTickets.mockRejectedValue(Object.assign(
      new Error("PGRST002 permission denied for table support_tickets select *"),
      { status: 503, code: "PGRST002" },
    ));
    wrap(<TicketsTab mode="workspace" tenantId={tenantId} />);
    expect(await screen.findByText("Unable To Reach The Service")).toBeTruthy();
    expect(screen.queryByText("No tickets match these filters.")).toBeNull();
    expect(screen.queryByText(/PGRST002|permission denied|select \* from support_tickets/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mockApis.listTickets).toHaveBeenCalledTimes(2));
  });

  it("surfaces a safe access state for Knowledge reads instead of reporting zero articles", async () => {
    mockApis.listKnowledge.mockRejectedValue(Object.assign(
      new Error("permission denied for table kb_articles: PGRST301"),
    ));
    wrap(<NavigatorHub scope="workspace" tenantId={tenantId} />);
    expect(await screen.findByText("You Don't Currently Have Access")).toBeTruthy();
    expect(screen.queryByText(/0 articles/)).toBeNull();
    expect(screen.queryByText(/permission denied|PGRST301|kb_articles/)).toBeNull();
  });

  it("maps known approval conflicts to reviewed copy and hides unknown raw provider text", () => {
    expect(safeActionErrorMessage(new Error("maker cannot approve own manual match")))
      .toBe("A different authorized reviewer must approve this match.");
    expect(safeActionErrorMessage(new Error("PGRST002: permission denied for table")))
      .not.toMatch(/PGRST002|permission denied/i);
  });
});
