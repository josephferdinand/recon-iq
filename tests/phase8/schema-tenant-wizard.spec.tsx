// End-to-end: SchemaTenantWizardPanel wizard flow — open, step through,
// submit, and verify the request payload includes justification text.
// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const listMock = vi.fn();
const createMock = vi.fn();
vi.mock("@/lib/phase8-silo.functions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/phase8-silo.functions")>(
    "@/lib/phase8-silo.functions",
  );
  return {
    ...actual,
    listSchemaPerTenantRequests: (a: unknown) => listMock(a),
    createSchemaPerTenantRequest: (a: unknown) => createMock(a),
  };
});

import { SchemaTenantWizardPanel } from "@/components/console/schema-tenant-wizard-panel";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => { listMock.mockReset(); createMock.mockReset(); });
afterEach(() => cleanup());

describe("SchemaTenantWizardPanel — e2e flow", () => {
  it("walks through the 3-step wizard and submits with justification", async () => {
    listMock.mockResolvedValue([]);
    createMock.mockResolvedValue({ id: "r1", status: "open" });
    wrap(<SchemaTenantWizardPanel tenantId="00000000-0000-0000-0000-000000000001" />);

    fireEvent.click(await screen.findByRole("button", { name: /new request/i }));
    fireEvent.change(screen.getByLabelText(/regulator/i), { target: { value: "FCA CASS 6.6.34R" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    const justification = "Data-residency clause mandates dedicated schema separation for this client.";
    fireEvent.change(screen.getByLabelText(/regulatory \/ risk justification/i), {
      target: { value: justification },
    });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    fireEvent.click(await screen.findByRole("button", { name: /submit request/i }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const payload = createMock.mock.calls[0][0] as { data: { tenant_id: string; regulator_ref?: string; justification: string } };
    expect(payload.data.tenant_id).toBe("00000000-0000-0000-0000-000000000001");
    expect(payload.data.regulator_ref).toBe("FCA CASS 6.6.34R");
    expect(payload.data.justification).toContain("Data-residency clause");
  });

  it("renders history rows returned by the server", async () => {
    listMock.mockResolvedValue([
      { id: "r1", regulator_ref: "MAS TRM", justification: "j", status: "reviewing", created_at: new Date().toISOString() },
    ]);
    wrap(<SchemaTenantWizardPanel tenantId="00000000-0000-0000-0000-000000000001" />);
    await waitFor(() => expect(screen.getByText("MAS TRM")).toBeTruthy());
    expect(screen.getByText("reviewing")).toBeTruthy();
  });

  it("disables the New request button when canRequest is false", async () => {
    listMock.mockResolvedValue([]);
    wrap(<SchemaTenantWizardPanel tenantId="00000000-0000-0000-0000-000000000001" canRequest={false} />);
    const btn = (await screen.findByText("New request")).closest("button")!;
    expect(btn.disabled).toBe(true);
  });
});
