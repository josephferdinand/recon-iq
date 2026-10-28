// End-to-end: AttestationsPanel renders SOC 2 register + sign-off cards and
// triggers the export bundle server fn on click.
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

const listControlsMock = vi.fn();
const listRunsMock = vi.fn();
const exportMock = vi.fn();
vi.mock("@/lib/soc2.functions", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/soc2.functions");
  return {
    ...actual,
    listSoc2Controls: (a?: unknown) => listControlsMock(a),
    listSoc2Runs: (a: unknown) => listRunsMock(a),
    exportSoc2Bundle: (a?: unknown) => exportMock(a),
  };
});

const listSignoffsMock = vi.fn();
vi.mock("@/lib/signoff.functions", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/signoff.functions");
  return {
    ...actual,
    listSignoffs: (a: unknown) => listSignoffsMock(a),
  };
});

import { AttestationsPanel } from "@/components/console/attestations-panel";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// jsdom lacks URL.createObjectURL — stub before tests exercise the export path.
beforeEach(() => {
  listControlsMock.mockReset();
  listRunsMock.mockReset();
  listSignoffsMock.mockReset();
  exportMock.mockReset();
  // @ts-expect-error jsdom stub
  URL.createObjectURL = vi.fn(() => "blob:mock");
  // @ts-expect-error jsdom stub
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
});
afterEach(() => cleanup());

describe("AttestationsPanel — e2e", () => {
  it("shows control register + sign-offs and computes coverage", async () => {
    listControlsMock.mockResolvedValue([
      { id: "c1", control_code: "CC6.1", tsc: "Security", title: "Access control", owner: "CISO" },
      { id: "c2", control_code: "CC7.2", tsc: "Security", title: "System monitoring" },
    ]);
    listRunsMock.mockResolvedValue([
      { id: "r1", control_id: "c1", status: "passed", collected_at: new Date().toISOString() },
    ]);
    listSignoffsMock.mockResolvedValue([
      { id: "s1", period_date: "2026-07-07", scope: "EOD", status: "approved", approved_at: new Date().toISOString() },
    ]);
    wrap(<AttestationsPanel tenantId="00000000-0000-0000-0000-000000000001" />);
    await waitFor(() => expect(screen.getByText("Access control")).toBeTruthy());
    expect(screen.getByText("System monitoring")).toBeTruthy();
    expect(screen.getByText("2026-07-07")).toBeTruthy();
    // 1 evidenced of 2 controls → 50% coverage
    expect(screen.getByText("50%")).toBeTruthy();
  });

  it("invokes exportSoc2Bundle when Export bundle is clicked", async () => {
    listControlsMock.mockResolvedValue([
      { id: "c1", control_code: "CC6.1", tsc: "Security", title: "Access control" },
    ]);
    listRunsMock.mockResolvedValue([]);
    listSignoffsMock.mockResolvedValue([]);
    exportMock.mockResolvedValue({ sha256: "abcdef0123456789", bundle: { controls: [], evidence: [] } });
    wrap(<AttestationsPanel tenantId="00000000-0000-0000-0000-000000000001" />);
    const btn = await screen.findByRole("button", { name: /export bundle/i });
    fireEvent.click(btn);
    await waitFor(() => expect(exportMock).toHaveBeenCalledTimes(1));
  });

  it("respects canExport=false by disabling the export button", async () => {
    listControlsMock.mockResolvedValue([]);
    listRunsMock.mockResolvedValue([]);
    listSignoffsMock.mockResolvedValue([]);
    wrap(<AttestationsPanel tenantId="00000000-0000-0000-0000-000000000001" canExport={false} />);
    const btn = (await screen.findByText("Export bundle")).closest("button")!;
    expect(btn.disabled).toBe(true);
  });
});
