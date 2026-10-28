import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("primary Exceptions workbench route", () => {
  it("lands on the existing tenant-gated queue rather than a duplicate hub with placeholder destinations", async () => {
    const hub = await readFile("src/routes/_authenticated/$slug/hub.exceptions.tsx", "utf8");
    const workspace = await readFile("src/routes/_authenticated/$slug/workspace.tsx", "utf8");

    expect(hub).toContain('<Navigate to="/$slug/workspace" params={{ slug }} search={{ page: "exceptions" }} replace />');
    expect(hub).not.toContain("HubShell");
    expect(hub).not.toContain("/recon/evidence");
    expect(workspace).toContain('{page === "exceptions" && <ErrorBoundary label="Exceptions"><ExceptionsTab tenantId={tenant.id} canWrite={canWrite} /></ErrorBoundary>}');
    expect(workspace).toContain('<PageGate tenantId={tenant.id} permission={currentPageDef?.permission ?? null}');
  });
});
