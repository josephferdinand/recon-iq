import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("owner-approved lean administration navigation", () => {
  it("moves Access Explorer out of Workspace without deleting its tenant route", async () => {
    const [workspace, tenant] = await Promise.all([
      readFile("src/routes/_authenticated/$slug/workspace.tsx", "utf8"),
      readFile("src/routes/_authenticated/$slug/tenant.tsx", "utf8"),
    ]);
    expect(workspace).toContain('item.key !== "access-explorer"');
    expect(workspace).toContain('search={{ page: "access-explorer" }}');
    expect(tenant).toContain('page === "access-explorer"');
    expect(tenant).toContain("<AccessExplorer tenantId={tenant.id} />");
  });

  it("keeps the operator rail to the nine approved destinations", async () => {
    const workspace = await readFile("src/routes/_authenticated/$slug/workspace.tsx", "utf8");
    for (const label of [
      "Home",
      "Ingestion",
      "Data Prep",
      "Reconciliations",
      "Exceptions",
      "Insights",
      "Reports",
      "Tasks & Approvals",
      "Support",
    ]) {
      expect(workspace).toContain(`label: "${label}"`);
    }
    expect(workspace).toContain("const WORKSPACE_SECTIONS: WorkspaceSection[]");
    for (const landing of ["dashboard", "ingest", "prep", "recons", "exceptions", "ageing", "reports", "manual-approvals", "tickets"]) {
      expect(workspace).toContain(`key: "${landing}"`);
    }
    expect(workspace).toContain('<WorkspaceRail sections={workspaceRailSections} activeKey={activeRailKey}');
    expect(workspace).toContain("<WorkspaceSectionNav");
    expect(workspace).toContain("section.pages.filter(canSeePage)");
    expect(workspace).toContain('key === "my-templates"');
    expect(workspace).toContain('to: `/${slug}/workspace/templates`');
    expect(workspace).not.toContain('<SidebarSection label="Template Marketplace"');
  });

  it("removes the duplicate tenant Advanced rail while preserving its routes", async () => {
    const [tenant, routes] = await Promise.all([
      readFile("src/routes/_authenticated/$slug/tenant.tsx", "utf8"),
      Promise.all(
        [
          "src/routes/_authenticated/$slug/tenant.admin.tsx",
          "src/routes/_authenticated/$slug/tenant.pipeline-status.tsx",
          "src/routes/_authenticated/$slug/tenant.settings.domain.tsx",
          "src/routes/_authenticated/$slug/tenant.settings.scale.tsx",
          "src/routes/_authenticated/$slug/tenant.settings.verticals.tsx",
        ].map((path) => readFile(path, "utf8")),
      ),
    ]);
    expect(tenant).not.toContain('<SidebarSection label="Advanced">');
    expect(tenant).toContain("TENANT_HIDDEN_FROM_PRIMARY_NAV");
    expect(tenant).toContain('"pipeline-status"]');
    expect(tenant).toContain('permSet.has("tenant.settings.read")');
    expect(tenant).toContain("{isAdmin && <Link");
    for (const path of ["admin", "pipeline-status", "settings/domain", "settings/scale", "settings/verticals"]) {
      expect(tenant).toContain(`to="/$slug/tenant/${path}"`);
    }
    expect(routes.every((source) => source.includes("createFileRoute"))).toBe(true);
    expect(tenant).toContain('page === "pipeline-status"');
    expect(tenant).toContain('to="/$slug/tenant/pipeline-status"');
  });

  it("hides legacy Platform duplicates while retaining their render paths", async () => {
    const platform = await readFile("src/routes/_authenticated/platform.tsx", "utf8");
    for (const key of [
      "roadmap",
      "rbac-diagnostics",
      "ai-gov-legacy",
      "llm-legacy",
      "secrets",
      "persona-journeys",
      "gap-closure",
    ]) {
      expect(platform).toContain(`"${key}"`);
      expect(platform).toContain(`page === "${key}"`);
    }
    expect(platform).toContain("PLATFORM_RAIL_PAGES");
  });

  it("consolidates platform access, delivery, health and backup tools contextually", async () => {
    const platform = await readFile("src/routes/_authenticated/platform.tsx", "utf8");
    for (const key of [
      "role-matrix",
      "groups",
      "access-explorer",
      "migrations",
      "schema-drift",
      "github",
      "recon-health",
      "worker-health",
      "backup",
      "tenant-backups",
    ]) {
      expect(platform).toContain(`"${key}"`);
      expect(platform).toContain(`page === "${key}"`);
    }
    expect(platform).toContain("PLATFORM_CONTEXT_SECTIONS");
    expect(platform).toContain("<PlatformContextNav");
    expect(platform).toContain('label: "Environment & Delivery"');
    expect(platform).toContain('label: "Reliability & Operations"');
    expect(platform).toContain('label: "Access management"');
    const hidden = platform.match(/const PLATFORM_HIDDEN_FROM_PRIMARY_NAV = new Set\(\[([\s\S]*?)\]\);/u)?.[1];
    expect(hidden).toBeDefined();
    for (const key of ["families", "sandbox-access", "session-anomalies", "kb-templates", "security-audit", "soc2-monitor", "policy-auditor", "ai-gov-legacy", "llm-legacy"]) {
      expect(hidden).toContain(`"${key}"`);
      expect(platform).toContain(`page === "${key}"`);
    }
    for (const [primary, secondary] of [
      ["tenants", "families"],
      ["sessions-security", "session-anomalies"],
      ["ai-control-plane", "llm-legacy"],
      ["kb", "kb-templates"],
      ["audit", "security-audit"],
    ]) {
      expect(platform).toMatch(new RegExp(`primary: "${primary}"[\\s\\S]*?pages: \\["${primary}"[^\\]]*"${secondary}"`, "u"));
    }
  });
});
