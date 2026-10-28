// End-to-end: LoansExposurePanel aggregates outstanding, collateral, LTV,
// and top borrowers from mocked server-fn responses.
// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

const listLoanFacilitiesMock = vi.fn();
const listCollateralPledgesMock = vi.fn();
const listSecLendingLoansMock = vi.fn();
vi.mock("@/lib/phase8-loan-vertical.functions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/phase8-loan-vertical.functions")>(
    "@/lib/phase8-loan-vertical.functions",
  );
  return {
    ...actual,
    listLoanFacilities: (a: unknown) => listLoanFacilitiesMock(a),
    listCollateralPledges: (a: unknown) => listCollateralPledgesMock(a),
    listSecLendingLoans: (a: unknown) => listSecLendingLoansMock(a),
  };
});

import { LoansExposurePanel } from "@/components/console/loans-exposure-panel";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  listLoanFacilitiesMock.mockReset();
  listCollateralPledgesMock.mockReset();
  listSecLendingLoansMock.mockReset();
});
afterEach(() => cleanup());

describe("LoansExposurePanel — e2e", () => {
  it("renders KPI tiles + borrower row from server data", async () => {
    listLoanFacilitiesMock.mockResolvedValue([
      { id: "f1", facility_ref: "F-1", borrower: "Acme Corp", currency: "USD", principal_amount: 1_000_000, outstanding_amount: 800_000, status: "active" },
      { id: "f2", facility_ref: "F-2", borrower: "Beta Ltd",  currency: "USD", principal_amount: 500_000,   outstanding_amount: 400_000, status: "active" },
    ]);
    listCollateralPledgesMock.mockResolvedValue([
      { id: "p1", facility_id: "f1", collateral_type: "govt-bond", market_value: 1_500_000, haircut_pct: 5, effective_value: 1_425_000, currency: "USD" },
    ]);
    listSecLendingLoansMock.mockResolvedValue([]);
    wrap(<LoansExposurePanel tenantId="00000000-0000-0000-0000-000000000001" />);
    await waitFor(() => expect(screen.getAllByText("Acme Corp").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Beta Ltd").length).toBeGreaterThan(0);
    // Outstanding = 1.2M, collateral effective = 1.425M so LTV ≈ 84.2%
    expect(screen.getByText(/8[34]\.\d%/)).toBeTruthy();
    expect(listLoanFacilitiesMock).toHaveBeenCalledWith({
      data: { tenant_id: "00000000-0000-0000-0000-000000000001" },
    });
  });

  it("shows empty state when nothing is returned", async () => {
    listLoanFacilitiesMock.mockResolvedValue([]);
    listCollateralPledgesMock.mockResolvedValue([]);
    listSecLendingLoansMock.mockResolvedValue([]);
    wrap(<LoansExposurePanel tenantId="00000000-0000-0000-0000-000000000001" />);
    await waitFor(() => expect(screen.getByText(/No loan-vertical data yet/i)).toBeTruthy());
  });
});
