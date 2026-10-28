// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const state = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: any) => ({ data: options.queryKey?.[0] === "pipes" ? { rows: [], total: 0, page: 0, page_size: 25 } : undefined, isPending: false, isLoading: false, isError: false, refetch: vi.fn() }), useQueryClient: () => ({ invalidateQueries: vi.fn() }), useMutation: () => ({ mutate: state.mutate, isPending: false }) }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: any) => fn }));
vi.mock("@/lib/data-prep.functions", () => Object.fromEntries(["listPipelines", "upsertPipeline", "deletePipeline", "listPipelineRuns", "approvePipeline", "cancelPipelineRun", "cloneAsStaging", "requestPromotion", "approvePromotion", "rejectPromotion", "discardStaging", "diffStaging", "listAffectedRecons"].map(name => [name, vi.fn()])));
vi.mock("@/lib/data-sources.functions", () => ({ listDataSourceOptions: vi.fn() }));
vi.mock("@/lib/resource-access-summaries.functions", () => ({ getResourceAccessSummaries: vi.fn() }));
vi.mock("@/lib/resource-actor-summaries.functions", () => ({ getResourceActorSummaries: vi.fn() }));
vi.mock("@/hooks/use-access", () => ({ useAccess: () => ({ can: () => true, has: () => true }) }));
vi.mock("@/components/confirm-dialog", () => ({ useConfirm: () => ({ confirm: vi.fn(async () => false), ConfirmDialog: null }) }));
vi.mock("@/components/typed-resource-access-editor", () => ({ TypedResourceAccessEditor: () => null }));
vi.mock("@/components/data-prep-request-recovery", () => ({ DataPrepRequestRecovery: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
import { DataPrepTab } from "@/components/data-prep-tab";
beforeEach(() => { state.mutate.mockClear(); });
afterEach(cleanup);
function openEditor() { render(<DataPrepTab tenantId="11111111-1111-4111-8111-111111111111" canWrite/>); fireEvent.click(screen.getByRole("button", { name: "New pipeline", exact: true })); }
describe("reviewed Data Prep editor delta", () => {
  it("exposes meaningful accessible editor and transformation controls", () => { openEditor(); expect(screen.getByLabelText("Name", { exact: true })).toBeTruthy(); expect(screen.getByLabelText("Description", { exact: true })).toBeTruthy(); expect(screen.getByRole("combobox", { name: "On failure" })).toBeTruthy(); expect(screen.getByRole("combobox", { name: "Source data source" })).toBeTruthy(); expect(screen.getByRole("combobox", { name: "Output data source" })).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "Add step" })); expect(screen.getByRole("combobox", { name: "Transformation step 1 type" })).toBeTruthy(); expect(screen.getByRole("textbox", { name: "Transformation step 1 Field" })).toBeTruthy(); });
  it("keeps a missing transform parameter local, focuses it, and submits only after correction", () => { openEditor(); fireEvent.change(screen.getByLabelText("Name", { exact: true }), { target: { value: "QA valid editor" } }); fireEvent.click(screen.getByRole("button", { name: "Add step" })); fireEvent.click(screen.getByRole("button", { name: "Save", exact: true })); expect(screen.getByRole("alert").textContent).toContain("Step 1: Field is required"); const field = screen.getByRole("textbox", { name: "Transformation step 1 Field" }); expect(document.activeElement).toBe(field); expect(state.mutate).not.toHaveBeenCalled(); fireEvent.change(field, { target: { value: "account" } }); fireEvent.click(screen.getByRole("button", { name: "Save", exact: true })); expect(state.mutate).toHaveBeenCalledTimes(1); expect(state.mutate).toHaveBeenCalledWith(expect.objectContaining({ steps: [{ kind: "trim", field: "account" }] })); });
  it("does not carry stale validation messages into a newly opened editor", () => { openEditor(); fireEvent.change(screen.getByLabelText("Name", { exact: true }), { target: { value: "QA draft" } }); fireEvent.click(screen.getByRole("button", { name: "Add rule" })); fireEvent.click(screen.getByRole("button", { name: "Save", exact: true })); expect(screen.getByRole("alert")).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true })); fireEvent.click(screen.getByRole("button", { name: "New pipeline", exact: true })); expect(screen.queryByRole("alert")).toBeNull(); expect(state.mutate).not.toHaveBeenCalled(); });
});
