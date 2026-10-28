// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { listSchedules, listRecons, upsertSchedule, deleteSchedule, triggerSchedule, listRuns } = vi.hoisted(() => ({
  listSchedules: vi.fn(),
  listRecons: vi.fn(),
  upsertSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  triggerSchedule: vi.fn(),
  listRuns: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/recon-schedules.functions", () => ({
  listReconSchedules: listSchedules,
  upsertReconSchedule: upsertSchedule,
  deleteReconSchedule: deleteSchedule,
  triggerReconScheduleNow: triggerSchedule,
  listScheduleRuns: listRuns,
}));
vi.mock("@/lib/recons.functions", () => ({ listRecons }));
vi.mock("@/lib/user-feedback", () => ({ notifyUserError: vi.fn() }));

import { ReconSchedulesTab } from "@/components/recon-schedules-tab";

const tenantId = "11111111-1111-4111-8111-111111111111";
const definitionId = "22222222-2222-4222-8222-222222222222";

function show(canWrite = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReconSchedulesTab tenantId={tenantId} canWrite={canWrite} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("reconciliation schedule orchestrator", () => {
  it("announces loading without showing an empty state before persisted reads finish", () => {
    listSchedules.mockReturnValue(new Promise(() => {}));
    listRecons.mockReturnValue(new Promise(() => {}));
    show();

    expect(screen.getByRole("status").textContent).toContain("Loading schedules");
    expect(screen.queryByText(/No recurring schedules are configured/)).toBeNull();
  });

  it("keeps schedule service errors safe and retries into the real empty state", async () => {
    listSchedules
      .mockRejectedValueOnce(new Error("private schedule transport detail"))
      .mockResolvedValueOnce([]);
    listRecons.mockResolvedValue([]);
    show();

    const error = await screen.findByRole("alert");
    expect(error.textContent).toContain("temporarily unavailable");
    expect(error.textContent).not.toContain("private schedule transport detail");
    expect(screen.queryByText(/No recurring schedules are configured/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/No recurring schedules are configured yet/)).toBeTruthy();
    expect(listSchedules).toHaveBeenCalledTimes(2);
  });

  it("does not turn a failed reconciliation lookup into a false empty result", async () => {
    listSchedules.mockResolvedValue([]);
    listRecons
      .mockRejectedValueOnce(new Error("private reconciliation transport detail"))
      .mockResolvedValueOnce([]);
    show();
    await screen.findByRole("button", { name: "New schedule" });
    fireEvent.click(screen.getByRole("button", { name: "New schedule" }));

    const error = await screen.findByRole("alert");
    expect(error.textContent).toContain("temporarily unavailable");
    expect(error.textContent).not.toContain("private reconciliation transport detail");
    expect(screen.queryByText(/No reconciliations are available/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/No reconciliations are available to schedule/)).toBeTruthy();
  });

  it("creates a recurring schedule from a persisted reconciliation using the selected UTC cadence", async () => {
    listSchedules.mockResolvedValue([]);
    listRecons.mockResolvedValue([{ id: definitionId, name: "Ledger reconciliation", recon_type: "two_sided" }]);
    upsertSchedule.mockResolvedValue({ id: "created-schedule" });
    show();

    fireEvent.click(await screen.findByRole("button", { name: "New schedule" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Reconciliation" }));
    fireEvent.click(await screen.findByRole("option", { name: /Ledger reconciliation/ }));
    fireEvent.click(screen.getByRole("combobox", { name: "Cadence preset" }));
    expect(await screen.findAllByRole("option")).toHaveLength(16);
    fireEvent.click(screen.getByRole("option", { name: "Every 15 minutes" }));
    expect(screen.getByLabelText("Cron expression (UTC)")).toHaveProperty("value", "*/15 * * * *");
    fireEvent.change(screen.getByLabelText("Schedule name"), { target: { value: "Daily ledger close" } });
    fireEvent.click(screen.getByRole("button", { name: "Create schedule" }));

    await waitFor(() => expect(upsertSchedule).toHaveBeenCalledWith({
      data: {
        tenant_id: tenantId,
        definition_id: definitionId,
        name: "Daily ledger close",
        cron_expression: "*/15 * * * *",
        enabled: true,
      },
    }));
  });

  it("shows stored schedule status and named actions, while editing preserves the pause setting", async () => {
    listSchedules.mockResolvedValue([{
      id: "schedule-one",
      definition_id: definitionId,
      name: "Ledger QA",
      cron_expression: "0 6 * * 1-5",
      enabled: false,
      last_status: "retry_scheduled",
      last_run_at: "2026-09-24T10:00:00.000Z",
      last_error: "private last run detail",
      definition: { name: "Ledger reconciliation" },
    }]);
    listRecons.mockResolvedValue([{ id: definitionId, name: "Ledger reconciliation", recon_type: "two_sided" }]);
    listRuns.mockResolvedValue([]);
    upsertSchedule.mockResolvedValue({ id: "schedule-one" });
    triggerSchedule.mockResolvedValue({ ok: true, matched: 4, exceptions: 1 });
    deleteSchedule.mockResolvedValue({});
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    show();

    expect(await screen.findByText("Ledger QA")).toBeTruthy();
    expect(screen.getByText("Ledger reconciliation")).toBeTruthy();
    expect(screen.getByText("Paused")).toBeTruthy();
    expect(screen.getByText("Automatic dispatch is paused.")).toBeTruthy();
    expect(screen.getByText("Retry queued")).toBeTruthy();
    expect(screen.queryByText("private last run detail")).toBeNull();
    expect(screen.getByRole("button", { name: "Run schedule Ledger QA now" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "View history for schedule Ledger QA" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete schedule Ledger QA" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit schedule Ledger QA" }));
    expect(await screen.findByRole("heading", { name: "Edit schedule" })).toBeTruthy();
    expect(screen.getByLabelText("Schedule name")).toHaveProperty("value", "Ledger QA");
    expect(screen.getByRole("switch", { name: "Enabled" }).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(upsertSchedule).toHaveBeenCalledWith({
      data: {
        id: "schedule-one",
        tenant_id: tenantId,
        definition_id: definitionId,
        name: "Ledger QA",
        cron_expression: "0 6 * * 1-5",
        enabled: false,
      },
    }));

    fireEvent.click(screen.getByRole("button", { name: "Run schedule Ledger QA now" }));
    await waitFor(() => expect(triggerSchedule).toHaveBeenCalledWith({
      data: { id: "schedule-one", tenant_id: tenantId },
    }));
    fireEvent.click(screen.getByRole("button", { name: "Delete schedule Ledger QA" }));
    await waitFor(() => expect(deleteSchedule).toHaveBeenCalledWith({
      data: { id: "schedule-one", tenant_id: tenantId },
    }));
    expect(confirm).toHaveBeenCalledWith('Delete schedule "Ledger QA"?');
  });

  it("keeps schedule history empty and populated states tied to persisted reads", async () => {
    listSchedules.mockResolvedValue([{
      id: "schedule-one",
      definition_id: definitionId,
      name: "Ledger QA",
      cron_expression: "0 6 * * 1-5",
      enabled: true,
      last_status: "completed",
      last_run_at: "2026-09-24T10:00:00.000Z",
      last_error: null,
      definition: { name: "Ledger reconciliation" },
    }]);
    listRecons.mockResolvedValue([]);
    listRuns.mockResolvedValue([]);
    show(false);

    fireEvent.click(await screen.findByRole("button", { name: "View history for schedule Ledger QA" }));
    expect(await screen.findByText("No runs recorded for this schedule yet.")).toBeTruthy();
    await waitFor(() => expect(listRuns).toHaveBeenCalledWith({
      data: { schedule_id: "schedule-one", tenant_id: tenantId },
    }));
    expect(screen.queryByRole("button", { name: "Edit schedule Ledger QA" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Run schedule Ledger QA now" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete schedule Ledger QA" })).toBeNull();
  });

  it("shows a safe history error with a real retry action", async () => {
    listSchedules.mockResolvedValue([{
      id: "schedule-one",
      definition_id: definitionId,
      name: "Ledger QA",
      cron_expression: "0 6 * * 1-5",
      enabled: true,
      last_status: null,
      last_run_at: null,
      last_error: null,
      definition: { name: "Ledger reconciliation" },
    }]);
    listRecons.mockResolvedValue([]);
    listRuns
      .mockRejectedValueOnce(new Error("private history transport detail"))
      .mockResolvedValueOnce([]);
    show(false);

    fireEvent.click(await screen.findByRole("button", { name: "View history for schedule Ledger QA" }));
    const error = await screen.findByRole("alert");
    expect(error.textContent).toContain("temporarily unavailable");
    expect(error.textContent).not.toContain("private history transport detail");
    expect(screen.queryByText("No runs recorded for this schedule yet.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No runs recorded for this schedule yet.")).toBeTruthy();
  });
});
