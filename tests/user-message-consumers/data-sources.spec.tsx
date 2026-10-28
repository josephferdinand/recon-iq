// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { api } = vi.hoisted(() => ({
  api: {
    getDataSource: vi.fn(), listDataSourcesPage: vi.fn(), createDataSource: vi.fn(), deleteDataSource: vi.fn(),
    registerUpload: vi.fn(), updateDataSource: vi.fn(), getResourceAccessSummaries: vi.fn(), getResourceActorSummaries: vi.fn(),
  },
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/data-sources.functions", () => api);
vi.mock("@/lib/resource-access-summaries.functions", () => ({ getResourceAccessSummaries: api.getResourceAccessSummaries }));
vi.mock("@/lib/resource-actor-summaries.functions", () => ({ getResourceActorSummaries: api.getResourceActorSummaries }));
vi.mock("@/components/confirm-dialog", () => ({ useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), ConfirmDialog: null }) }));
vi.mock("@/components/resource-identity-summary", () => ({ ResourceIdentitySummary: () => null }));
vi.mock("@/components/resource-actor-summary", () => ({ ResourceActorSummary: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { DataSourcesTab } from "@/components/data-sources-tab";

const tenantId = "11111111-1111-4111-8111-111111111111";

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  api.listDataSourcesPage.mockResolvedValue({ rows: [], total: 0, page: 1, page_size: 25, total_pages: 0 });
  api.getResourceAccessSummaries.mockResolvedValue({ available: true, rows: [] });
  api.getResourceActorSummaries.mockResolvedValue({ available: true, rows: [] });
  render(<QueryClientProvider client={client}><DataSourcesTab tenantId={tenantId} canWrite /></QueryClientProvider>);
  return client;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("workspace Data Sources messages", () => {
  it("shows required name validation beside the field and retains the create form", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "New data source" }));
    fireEvent.click(screen.getByRole("button", { name: "Create data source" }));

    expect(await screen.findByText("Name is required.")).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).getAttribute("aria-invalid")).toBe("true");
    expect(api.createDataSource).not.toHaveBeenCalled();
  });

  it("creates a valid source through the existing action", async () => {
    api.createDataSource.mockResolvedValue({ id: "22222222-2222-4222-8222-222222222222", name: "Daily cash feed" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "New data source" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Daily cash feed" } });
    fireEvent.click(screen.getByRole("button", { name: "Create data source" }));

    await waitFor(() => expect(api.createDataSource).toHaveBeenCalledTimes(1));
    expect(api.createDataSource).toHaveBeenCalledWith({ data: expect.objectContaining({ name: "Daily cash feed", tenant_id: tenantId }) });
  });

  it("preserves an uncertain create outcome and refreshes the existing source list before another submit", async () => {
    api.createDataSource.mockRejectedValue({ code: "WRITE_OUTCOME_UNKNOWN", status: 503, message: "select private_payload from hidden_table" });
    const client = mount();
    fireEvent.click(await screen.findByRole("button", { name: "New data source" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Daily cash feed" } });
    fireEvent.click(screen.getByRole("button", { name: "Create data source" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Check the existing request and its status before retrying");
    expect(alert.textContent).not.toContain("private_payload");
    fireEvent.click(screen.getByRole("button", { name: "Refresh data sources" }));
    await waitFor(() => expect(api.listDataSourcesPage).toHaveBeenCalledTimes(2));
    expect(api.createDataSource).toHaveBeenCalledTimes(1);
    expect(client.getQueryCache().getAll().length).toBeGreaterThan(0);
  });
});
