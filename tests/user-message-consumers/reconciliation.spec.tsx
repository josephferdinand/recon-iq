// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { api, owner } = vi.hoisted(() => ({
  owner: "11111111-1111-4111-8111-111111111111",
  api: {
    listReconsPage: vi.fn(),
    upsertRecon: vi.fn(),
    deleteRecon: vi.fn(),
    runReconDefinition: vi.fn(),
    listRuns: vi.fn(),
    listReconRetirementRequests: vi.fn(),
    requestReconRetirement: vi.fn(),
    decideReconRetirement: vi.fn(),
    exportReconDefinitions: vi.fn(),
    importReconDefinitions: vi.fn(),
    listBusinessUnits: vi.fn(),
    listDataSourceOptions: vi.fn(),
    listApprovedPipelinesForRecon: vi.fn(),
    listReferenceTables: vi.fn(),
    getResourceAccessSummaries: vi.fn(),
    getResourceActorSummaries: vi.fn(),
    listBusinessUnits: vi.fn(),
  },
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/recons.functions", () => api);
vi.mock("@/lib/recon-retirement.functions", () => ({
  listReconRetirementRequests: api.listReconRetirementRequests,
  requestReconRetirement: api.requestReconRetirement,
  decideReconRetirement: api.decideReconRetirement,
}));
vi.mock("@/lib/recon-defs-io.functions", () => ({
  exportReconDefinitions: api.exportReconDefinitions,
  importReconDefinitions: api.importReconDefinitions,
}));
vi.mock("@/lib/business-units.functions", () => ({ listBusinessUnits: api.listBusinessUnits }));
vi.mock("@/lib/data-sources.functions", () => ({
  listDataSourceOptions: api.listDataSourceOptions,
}));
vi.mock("@/lib/data-prep.functions", () => ({
  listApprovedPipelinesForRecon: api.listApprovedPipelinesForRecon,
}));
vi.mock("@/lib/reference-data.functions", () => ({ listReferenceTables: api.listReferenceTables }));
vi.mock("@/lib/resource-access-summaries.functions", () => ({
  getResourceAccessSummaries: api.getResourceAccessSummaries,
}));
vi.mock("@/lib/resource-actor-summaries.functions", () => ({
  getResourceActorSummaries: api.getResourceActorSummaries,
}));
vi.mock("@/components/confirm-dialog", () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), ConfirmDialog: null }),
}));
vi.mock("@/components/recon-owner-picker", () => ({
  ReconOwnerPicker: ({
    value,
    onChange,
  }: {
    value: string[];
    onChange: (value: string[]) => void;
  }) => (
    <button type="button" onClick={() => onChange([owner])}>
      {value.length ? "Owner selected" : "Select owner"}
    </button>
  ),
}));
vi.mock("@/components/recon-studio-index", () => ({ ReconStudioIndex: () => <div /> }));
vi.mock("@/components/recon-run-detail-dialog", () => ({ ReconRunDetailWorkbench: () => null }));
vi.mock("@/components/recon-access-panel", () => ({ ReconAccessPanel: () => null }));
vi.mock("@/components/recon-permissions-sheet", () => ({ ReconPermissionsSheet: () => null }));
vi.mock("@/components/cascade-rules-sheet", () => ({ CascadeRulesSheet: () => null }));
vi.mock("@/components/new-recon-wizard", () => ({ NewReconWizard: () => null }));
vi.mock("@/components/rekon-version-diff", () => ({ RekonVersionDiffDialog: () => null }));
vi.mock("@/components/keyboard-shortcuts-dialog", () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock("@/hooks/use-keyboard-shortcuts", () => ({ useKeyboardShortcuts: vi.fn() }));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: unknown }) => <div>{children as any}</div>,
  DropdownMenuTrigger: ({ children }: { children: unknown }) => <>{children as any}</>,
  DropdownMenuContent: ({ children }: { children: unknown }) => <div>{children as any}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: unknown; onSelect: () => void }) => (
    <button type="button" onClick={onSelect}>
      {children as any}
    </button>
  ),
}));
vi.mock("@/components/resource-identity-summary", () => ({ ResourceIdentitySummary: () => null }));
vi.mock("@/components/resource-actor-summary", () => ({ ResourceActorSummary: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ReconsTab } from "@/components/recons-tab";

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  api.listReconsPage.mockResolvedValue({
    rows: [],
    total: 0,
    page: 1,
    page_size: 25,
    total_pages: 0,
  });
  api.listRuns.mockResolvedValue([]);
  api.listReconRetirementRequests.mockResolvedValue({ available: true, rows: [] });
  api.listBusinessUnits.mockResolvedValue([]);
  api.listDataSourceOptions.mockResolvedValue({
    rows: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Cash A",
        inferred_schema: [{ name: "account_id" }],
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Cash B",
        inferred_schema: [{ name: "account_id" }],
      },
    ],
    selected: [],
    limit: 10,
    truncated: false,
  });
  api.listApprovedPipelinesForRecon.mockResolvedValue([]);
  api.listReferenceTables.mockResolvedValue([]);
  api.getResourceAccessSummaries.mockResolvedValue({ available: true, rows: [] });
  api.getResourceActorSummaries.mockResolvedValue({ available: true, rows: [] });
  return render(
    <QueryClientProvider client={client}>
      <ReconsTab tenantId={owner} canWrite />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("workspace Reconciliation messages", () => {
  it("announces field-specific requirements before saving and does not submit", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Classic editor" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Name is required.")).toBeTruthy();
    expect(screen.getByText("Data source for side A is required.")).toBeTruthy();
    expect(screen.getByText("Data source for side B is required.")).toBeTruthy();
    expect(api.upsertRecon).not.toHaveBeenCalled();
  });
});
