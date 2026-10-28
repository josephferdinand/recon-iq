// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { api, owner } = vi.hoisted(() => ({
  api: {
    listWizardSourceCatalog: vi.fn(),
    previewWizardSource: vi.fn(),
    suggestMapping: vi.fn(),
    nlMapping: vi.fn(),
    saveDefinitionFromWizard: vi.fn(),
    saveApiSource: vi.fn(),
    saveDbConnection: vi.fn(),
    testWizardConnection: vi.fn(),
  },
  owner: "11111111-1111-4111-8111-111111111111",
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/rekon-wizard.functions", () => api);
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn() } }));

import { NewReconWizard } from "@/components/new-recon-wizard";

function mount(onCreated = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  api.listWizardSourceCatalog.mockResolvedValue({
    existing: [],
    refined: [],
    pdf: [],
    api: [],
    database: [],
  });
  const view = render(
    <QueryClientProvider client={client}>
      <NewReconWizard tenantId={owner} open onClose={vi.fn()} onCreated={onCreated} />
    </QueryClientProvider>,
  );
  return { client, onCreated, ...view };
}

async function reachSaveStep() {
  fireEvent.click(screen.getAllByRole("button", { name: "Select" })[0]);
  fireEvent.click(await screen.findByRole("button", { name: "Source A: PASTE DATA" }));
  fireEvent.change(screen.getByLabelText("Source A: paste CSV or TSV data"), {
    target: { value: "amount\n10" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
  fireEvent.click(await screen.findByText("Manually Configure"));
  await waitFor(() =>
    expect((screen.getByRole("button", { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
  fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
  await screen.findByRole("button", { name: "Save as draft" });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("workspace reconciliation wizard messages", () => {
  it("shows field-level validation for an empty name and missing owner without saving", async () => {
    mount();
    await reachSaveStep();
    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));

    expect(await screen.findByText("Reconciliation name is required.")).toBeTruthy();
    expect(screen.getByText("Owning business units is required.")).toBeTruthy();
    expect(api.saveDefinitionFromWizard).not.toHaveBeenCalled();
  });

  it("completes a positive one-sided manual-source draft without invoking AI inference", async () => {
    api.saveDefinitionFromWizard.mockResolvedValue({ id: "22222222-2222-4222-8222-222222222222" });
    const { onCreated } = mount();
    await reachSaveStep();
    fireEvent.change(screen.getByLabelText("Reconciliation name"), {
      target: { value: "Daily cash control" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Select owner" }));
    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));

    await waitFor(() => expect(api.saveDefinitionFromWizard).toHaveBeenCalledTimes(1));
    expect(api.suggestMapping).not.toHaveBeenCalled();
    expect(api.nlMapping).not.toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222");
  });

  it("routes uncertain save outcomes to the reconciliation list without resubmitting", async () => {
    api.saveDefinitionFromWizard.mockRejectedValue({
      code: "WRITE_OUTCOME_UNKNOWN",
      status: 503,
      message: "select secret from private_table",
    });
    const { onCreated } = mount();
    await reachSaveStep();
    fireEvent.change(screen.getByLabelText("Reconciliation name"), {
      target: { value: "Daily cash control" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Select owner" }));
    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));

    const message = await screen.findByText(
      /Check the existing request and its status before retrying/,
    );
    const alert = message.closest("[role=alert]");
    expect(alert?.textContent).toContain(
      "Check the existing request and its status before retrying",
    );
    expect(alert?.textContent).not.toContain("private_table");
    fireEvent.click(
      screen.getByRole("button", { name: "Check reconciliation list before retrying" }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(""));
    expect(api.saveDefinitionFromWizard).toHaveBeenCalledTimes(1);
  });
});
