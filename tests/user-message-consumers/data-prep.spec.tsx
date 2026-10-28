// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { api } = vi.hoisted(() => ({
  api: {
    listPipelines: vi.fn(), upsertPipeline: vi.fn(), deletePipeline: vi.fn(), runPipeline: vi.fn(),
    listPipelineRuns: vi.fn(), approvePipeline: vi.fn(), revertPipelineToDraft: vi.fn(),
    cloneAsStaging: vi.fn(), requestPromotion: vi.fn(), approvePromotion: vi.fn(),
    rejectPromotion: vi.fn(), discardStaging: vi.fn(), diffStaging: vi.fn(), listAffectedRecons: vi.fn(),
    listDataSourceOptions: vi.fn(), getResourceAccessSummaries: vi.fn(), getResourceActorSummaries: vi.fn(),
  },
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/data-prep.functions", () => api);
vi.mock("@/lib/data-sources.functions", () => ({ listDataSourceOptions: api.listDataSourceOptions }));
vi.mock("@/lib/resource-access-summaries.functions", () => ({ getResourceAccessSummaries: api.getResourceAccessSummaries }));
vi.mock("@/lib/resource-actor-summaries.functions", () => ({ getResourceActorSummaries: api.getResourceActorSummaries }));
vi.mock("@/components/confirm-dialog", () => ({ useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), ConfirmDialog: null }) }));
vi.mock("@/components/resource-identity-summary", () => ({ ResourceIdentitySummary: () => null }));
vi.mock("@/components/resource-actor-summary", () => ({ ResourceActorSummary: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { DataPrepTab } from "@/components/data-prep-tab";

const tenantId = "11111111-1111-4111-8111-111111111111";

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  api.listPipelines.mockResolvedValue({ rows: [], total: 0, page: 0, page_size: 25, total_pages: 0 });
  api.listPipelineRuns.mockResolvedValue([]);
  api.listDataSourceOptions.mockResolvedValue({ rows: [], selected: [], limit: 100, truncated: false });
  api.getResourceAccessSummaries.mockResolvedValue({ available: true, rows: [] });
  api.getResourceActorSummaries.mockResolvedValue({ available: true, rows: [] });
  render(<QueryClientProvider client={client}><DataPrepTab tenantId={tenantId} canWrite /></QueryClientProvider>);
  return client;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("workspace Data Prep messages", () => {
  it("announces the required pipeline name inline and does not submit an invalid draft", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "New pipeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Name is required.")).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).getAttribute("aria-invalid")).toBe("true");
    expect(api.upsertPipeline).not.toHaveBeenCalled();
  });

  it("shows the saved pipeline after a successful positive workflow", async () => {
    api.upsertPipeline.mockResolvedValue({ public_uid: "DP-20261003-001" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "New pipeline" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Daily cash checks" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.upsertPipeline).toHaveBeenCalledTimes(1));
    expect(api.upsertPipeline).toHaveBeenCalledWith({ data: expect.objectContaining({ name: "Daily cash checks", tenant_id: tenantId }) });
  });

  it("does not invite a blind retry after an uncertain save and keeps the draft available", async () => {
    api.upsertPipeline.mockRejectedValue({ code: "WRITE_OUTCOME_UNKNOWN", status: 503, message: "select secret from private_data" });
    const client = mount();
    fireEvent.click(await screen.findByRole("button", { name: "New pipeline" }));
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Daily cash checks" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Check the existing request and its status before retrying");
    expect(alert.textContent).not.toContain("private_data");
    fireEvent.click(screen.getByRole("button", { name: "Refresh pipelines" }));
    await waitFor(() => expect(api.listPipelines).toHaveBeenCalledTimes(2));
    expect(api.upsertPipeline).toHaveBeenCalledTimes(1);
    expect(client.getQueryCache().getAll().length).toBeGreaterThan(0);
  });
});
