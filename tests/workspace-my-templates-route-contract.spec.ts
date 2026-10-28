import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("src/routes/_authenticated/$slug/workspace.templates.tsx", "utf8");
const marketplace = readFileSync("src/components/template-marketplace.tsx", "utf8");
const server = readFileSync("src/lib/template-marketplace.functions.ts", "utf8");

describe("Workspace My Templates route", () => {
  it("names the workspace and points users to assignment access controls", () => {
    expect(route).toContain("Workspace: {workspaceQ.data.name}");
    expect(route).toContain("Use Assignments below to review or manage this workspace’s template access and permissions.");
    expect(route).toContain('kind: "workspace"');
  });

  it("shows read-only tenant templates even before a workspace is provisioned", () => {
    expect(route).toContain("{tenantQ.data?.id ? (");
    expect(route).toContain("workspaceId: workspaceQ.data?.id");
    expect(route).toContain("Tenant templates remain visible; assignments are unavailable.");
    expect(marketplace).toContain('scope.kind === "workspace" && scope.workspaceId');
    expect(marketplace).toContain('<TenantInstalledTab tenantId={scope.tenantId} readOnly />');
  });

  it("shows retryable, non-technical errors for tenant and workspace lookup failures", () => {
    expect(route).toContain("Tenant information could not be loaded.");
    expect(route).toContain("Workspace information could not be loaded.");
    expect(route).toContain('onClick={() => tenantQ.refetch()}');
    expect(route).toContain('onClick={() => workspaceQ.refetch()}');
  });

  it("shows persisted template details without illustrative metrics", () => {
    for (const tab of ["Overview", "Versions", "Runs", "Audit"]) {
      expect(marketplace).toContain(`>${tab}<`);
    }
    expect(marketplace).toContain('from("tenant_template_versions")');
    expect(marketplace).toContain('from("recon_runs")');
    expect(server).toContain('eq("entity_type", "tenant_template")');
    expect(marketplace).toContain("No reconciliation runs are visible for the linked templates.");
    expect(marketplace).not.toContain("illustrative QA data");
  });
});
