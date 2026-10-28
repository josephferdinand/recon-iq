// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { listRequests, decideRequest, listDomains, verifyDomain } = vi.hoisted(() => ({
  listRequests: vi.fn(),
  decideRequest: vi.fn(),
  listDomains: vi.fn(),
  verifyDomain: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/signup-admission.functions", () => ({
  listSignupRequests: listRequests,
  decideSignupRequest: decideRequest,
  listTenantEmailDomains: listDomains,
  verifyTenantEmailDomain: verifyDomain,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { SignupAdmissionsTab } from "@/components/signup-admissions-tab";
import { TenantEmailDomainPanel } from "@/components/tenant-email-domain-panel";

const tenantId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const domainId = "33333333-3333-4333-8333-333333333333";

function show(component: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{component}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("tenant signup administration", () => {
  it("shows an unavailable state instead of a false empty queue", async () => {
    listRequests.mockRejectedValue(new Error("private database detail"));
    show(<SignupAdmissionsTab tenantId={tenantId} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Requests are temporarily unavailable");
    expect(alert.textContent).not.toContain("private database detail");
    expect(screen.queryByText("All caught up")).toBeNull();
    expect(decideRequest).not.toHaveBeenCalled();
  });

  it("requires confirmation and submits the exact tenant, request, and viewer decision", async () => {
    listRequests.mockResolvedValue([{
      id: requestId, tenant_id: tenantId, user_id: "44444444-4444-4444-8444-444444444444",
      email: "analyst@example.com", full_name: "Example Analyst", status: "pending",
      requested_at: "2026-09-25T00:00:00Z", decided_at: null,
    }]);
    decideRequest.mockResolvedValue({ status: "approved" });
    show(<SignupAdmissionsTab tenantId={tenantId} />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(decideRequest).not.toHaveBeenCalled();
    expect(screen.getByText(/tenant viewer access/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve access" }));
    await waitFor(() => expect(decideRequest).toHaveBeenCalledWith({
      data: { tenant_id: tenantId, request_id: requestId, decision: "approved" },
    }));
  });

  it("keeps a domain pending until the backend confirms DNS proof", async () => {
    listDomains.mockResolvedValue([{
      id: domainId, domain: "example.com", status: "pending",
      txt_name: "_fvi-email-verify.example.com", txt_value: "proof-token", verified_at: null,
    }]);
    verifyDomain.mockResolvedValue({ verified: false });
    show(<TenantEmailDomainPanel tenantId={tenantId} />);
    expect(await screen.findByText("Pending DNS proof")).toBeTruthy();
    expect(screen.getByText("_fvi-email-verify.example.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check DNS verification" }));
    await waitFor(() => expect(verifyDomain).toHaveBeenCalledWith({ data: { tenant_id: tenantId, domain_id: domainId } }));
    expect(screen.getByText("Pending DNS proof")).toBeTruthy();
  });
});
