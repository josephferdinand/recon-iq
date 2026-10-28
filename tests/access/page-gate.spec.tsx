// PageGate / PermissionGate integration tests across Workspace / Tenant /
// Platform style permission keys and role scenarios.
// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// useServerFn becomes an identity wrapper so the mocked server fns are
// invoked directly inside React Query.
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
}));

const getMyAccessMock = vi.fn();
vi.mock("@/lib/access.functions", () => ({
  getMyAccess: (args: unknown) => getMyAccessMock(args),
}));

const logAccessDecisionMock = vi.fn(() => Promise.resolve({ ok: true }));
vi.mock("@/lib/access-audit.functions", () => ({
  logAccessDecision: (args: unknown) => logAccessDecisionMock(args),
}));

// Import AFTER mocks are registered.
import { PageGate, PermissionGate } from "@/hooks/use-access";

function snap(perms: string[], extras: Partial<Record<string, unknown>> = {}) {
  return {
    user_id: "u1",
    tenant_id: "t1",
    bu_id: null,
    is_platform_admin: false,
    tenant_role: "tenant_member",
    permission_ids: perms,
    sources: [],
    resolved_at: new Date().toISOString(),
    ...extras,
  };
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  getMyAccessMock.mockReset();
  logAccessDecisionMock.mockClear();
});

describe("PageGate — Workspace permissions", () => {
  it("renders an accessible loading label while access is resolving", () => {
    getMyAccessMock.mockReturnValueOnce(new Promise(() => undefined));
    wrap(
      <PageGate tenantId="t1" permission="recon.definition.read" pageLabel="Rekon Studio">
        <span>OK</span>
      </PageGate>,
    );
    expect(screen.getByText("Resolving access…").className).toContain("text-foreground");
  });

  it("renders children for tenant_analyst holding recon.definition.read", async () => {
    getMyAccessMock.mockResolvedValueOnce(
      snap(["recon.definition.read"], { tenant_role: "tenant_analyst" }),
    );
    wrap(
      <PageGate tenantId="t1" permission="recon.definition.read" pageLabel="Rekon Studio">
        <span>OK</span>
      </PageGate>,
    );
    await waitFor(() => expect(screen.getByText("OK")).toBeTruthy());
    expect(logAccessDecisionMock).not.toHaveBeenCalled();
  });

  it("denies tenant_member without break.read and audits the denial", async () => {
    getMyAccessMock.mockResolvedValueOnce(snap([]));
    wrap(
      <PageGate tenantId="t1" permission="break.read" pageLabel="Break manager">
        <span>OK</span>
      </PageGate>,
    );
    await waitFor(() => expect(screen.getByText(/You Don't Currently Have Access/)).toBeTruthy());
    await waitFor(() => expect(logAccessDecisionMock).toHaveBeenCalledTimes(1));
    expect(logAccessDecisionMock.mock.calls[0][0]).toMatchObject({
      data: {
        tenant_id: "t1",
        decision: "deny",
        required_permission: "break.read",
      },
    });
  });

  it("treats permission=null as an open page", async () => {
    getMyAccessMock.mockResolvedValueOnce(snap([]));
    wrap(
      <PageGate tenantId="t1" permission={null} pageLabel="Knowledge">
        <span>OPEN</span>
      </PageGate>,
    );
    await waitFor(() => expect(screen.getByText("OPEN")).toBeTruthy());
  });
});

describe("PageGate — Tenant + Platform scenarios", () => {
  it("renders Tenant admin page for tenant_admin", async () => {
    getMyAccessMock.mockResolvedValueOnce(
      snap(["tenant.role.read"], { tenant_role: "tenant_admin" }),
    );
    wrap(
      <PageGate tenantId="t1" permission="tenant.role.read" pageLabel="Roles & Permissions">
        <span>ADMIN</span>
      </PageGate>,
    );
    await waitFor(() => expect(screen.getByText("ADMIN")).toBeTruthy());
  });

  it("grants every permission to a platform admin snapshot", async () => {
    // Server resolver inflates platform admins; here we mirror that.
    getMyAccessMock.mockResolvedValueOnce(
      snap(["security.byok.manage"], {
        is_platform_admin: true,
        tenant_role: "platform_admin",
      }),
    );
    wrap(
      <PageGate tenantId="t1" permission="security.byok.manage" pageLabel="BYOK">
        <span>BYOK-OK</span>
      </PageGate>,
    );
    await waitFor(() => expect(screen.getByText("BYOK-OK")).toBeTruthy());
  });
});

describe("PermissionGate — inline gating", () => {
  it("renders when anyOf matches at least one held permission", async () => {
    getMyAccessMock.mockResolvedValueOnce(snap(["break.read"]));
    wrap(
      <PermissionGate tenantId="t1" anyOf={["break.read", "audit.log.read"]}>
        <span>SHOW</span>
      </PermissionGate>,
    );
    await waitFor(() => expect(screen.getByText("SHOW")).toBeTruthy());
  });

  it("hides when allOf is not fully satisfied", async () => {
    getMyAccessMock.mockResolvedValueOnce(snap(["break.read"]));
    wrap(
      <PermissionGate
        tenantId="t1"
        allOf={["break.read", "audit.log.read"]}
        fallback={<span>HIDDEN</span>}
      >
        <span>SHOW</span>
      </PermissionGate>,
    );
    await waitFor(() => expect(screen.getByText("HIDDEN")).toBeTruthy());
  });

  it("hides when a single required permission is missing", async () => {
    getMyAccessMock.mockResolvedValueOnce(snap([]));
    wrap(
      <PermissionGate tenantId="t1" permission="recon.match.approve" fallback={<span>NO</span>}>
        <span>YES</span>
      </PermissionGate>,
    );
    await waitFor(() => expect(screen.getByText("NO")).toBeTruthy());
  });
});
