// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mockQueryState = vi.hoisted(() => ({ value: { data: undefined as unknown, isPending: false, isError: true, refetch: vi.fn() } }));
vi.mock("@tanstack/react-start", async (importOriginal) => ({ ...(await importOriginal<typeof import("@tanstack/react-start")>()), useServerFn: () => vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => mockQueryState.value,
  useMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { ReconAccessPanel } from "@/components/recon-access-panel";

afterEach(() => { cleanup(); mockQueryState.value = { data: undefined, isPending: false, isError: true, refetch: vi.fn() }; });

describe("reconciliation access panel", () => {
  it("surfaces unavailable setup with retry and no false empty-grants claim", () => {
    render(<ReconAccessPanel reconId="11111111-1111-4111-8111-111111111111" />);
    expect(screen.getByRole("alert").textContent).toContain("Access information temporarily unavailable");
    expect(screen.getByRole("button", { name: "Retry access check" })).toBeTruthy();
    expect(screen.queryByText(/no explicit grants/i)).toBeNull();
  });

  it("shows actual setup values and stages grants before enforcement is active", () => {
    mockQueryState.value = {
      data: {
        recon_id: "11111111-1111-4111-8111-111111111111",
        tenant_id: "22222222-2222-4222-8222-222222222222",
        multi_bu_governed: false,
        is_tenant_admin: true,
        owners: [{ bu_id: "33333333-3333-4333-8333-333333333333", created_at: "2026-09-24T00:00:00Z" }],
        grants: [{ grant_id: "55555555-5555-4555-8555-555555555555", bu_id: "33333333-3333-4333-8333-333333333333", principal_type: "group", principal_id: "44444444-4444-4444-8444-444444444444", action: "view", granted_at: "2026-09-24T00:00:00Z" }],
        effective_access: { view: true, run: false, edit: false, approve: false },
        available_business_units: [{ bu_id: "33333333-3333-4333-8333-333333333333", name: "Fund Accounting", code: "FA" }],
        available_principals: [{ principal_type: "group", principal_id: "44444444-4444-4444-8444-444444444444", label: "NAV Operations", bu_ids: ["33333333-3333-4333-8333-333333333333"] }],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(<ReconAccessPanel reconId="11111111-1111-4111-8111-111111111111" />);
    expect(screen.getAllByText("Fund Accounting").length).toBeGreaterThan(1);
    expect(screen.getByText("NAV Operations")).toBeTruthy();
    expect(screen.getByText(/Governance flag off · owner mapping only/)).toBeTruthy();
    expect(screen.getByText(/Owner mappings and grants are staged as shadow data/)).toBeTruthy();
    expect(screen.getByText(/Active tenant administrators manage ownership and grants within this tenant only/)).toBeTruthy();
    expect(screen.getByText(/No lock-state field is returned/)).toBeTruthy();
    expect(screen.getByText(/Retirement is separate: requester plus one different eligible approver/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Grant action" })).toBeTruthy();
    expect(screen.getByText(/staged shadow data/i)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Legacy access cutover" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cut over legacy access" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/requester plus one different eligible approver/)).toBeTruthy();
  });

  it("does not claim runtime enforcement when the multi-BU governance flag is on", () => {
    mockQueryState.value = {
      data: {
        recon_id: "11111111-1111-4111-8111-111111111111",
        tenant_id: "22222222-2222-4222-8222-222222222222",
        multi_bu_governed: true,
        is_tenant_admin: false,
        owners: [],
        grants: [],
        effective_access: { view: false, run: false, edit: false, approve: false },
        available_business_units: [],
        available_principals: [],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(<ReconAccessPanel reconId="11111111-1111-4111-8111-111111111111" />);
    expect(screen.getByText(/Multi-BU governance flag enabled/)).toBeTruthy();
    expect(screen.getByText(/this access view does not prove runtime API or RLS enforcement/)).toBeTruthy();
    expect(screen.getByText(/Managed by active tenant administrators/)).toBeTruthy();
  });

  it("shows same-tenant direct-user labels to tenant administrators without exposing UUIDs", () => {
    const tenantId = "22222222-2222-4222-8222-222222222222";
    const businessUnitId = "33333333-3333-4333-8333-333333333333";
    const principalId = "44444444-4444-4444-8444-444444444444";
    mockQueryState.value = {
      data: {
        recon_id: "11111111-1111-4111-8111-111111111111",
        tenant_id: tenantId,
        multi_bu_governed: false,
        is_tenant_admin: true,
        owners: [{ bu_id: businessUnitId, created_at: "2026-09-24T00:00:00Z" }],
        grants: [{ grant_id: "55555555-5555-4555-8555-555555555555", bu_id: businessUnitId, principal_type: "user", principal_id: principalId, action: "view", granted_at: "2026-09-24T00:00:00Z" }],
        effective_access: { view: true, run: false, edit: false, approve: false },
        available_business_units: [{ bu_id: businessUnitId, name: "Fund Accounting", code: "FA" }],
        available_principals: [{ principal_type: "user", principal_id: principalId, label: "maya@example.com", bu_ids: [businessUnitId] }],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(<ReconAccessPanel reconId="11111111-1111-4111-8111-111111111111" />);
    expect(screen.getAllByText("maya@example.com").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("Principal name unavailable");
    expect(document.body.textContent).not.toContain(principalId);
    expect(document.body.textContent).not.toContain(businessUnitId);
  });
});
