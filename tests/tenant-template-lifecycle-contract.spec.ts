import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260914220000_govern_tenant_template_lifecycle.sql", "utf8");
const server = readFileSync("src/lib/template-marketplace.functions.ts", "utf8");
const ui = readFileSync("src/components/template-marketplace.tsx", "utf8");

describe("My Templates governed lifecycle", () => {
  it("snapshots real reconciliations into immutable versions", () => {
    expect(migration).toContain("save_tenant_template_from_recon_atomic");
    expect(migration).toContain("guard_tenant_template_version_immutable");
    expect(migration).toContain("source_recon_definition_id");
    expect(server).toContain("saveTenantTemplateFromRecon");
  });

  it("enforces active membership and four-eyes publication", () => {
    expect(migration).toContain("AND tm.active");
    expect(migration).toContain("actor<>row.submitted_by AND actor<>version_row.created_by");
    expect(migration).toContain("invalid lifecycle transition or dual-control violation");
    expect(migration).toContain("guard_tenant_template_lifecycle");
  });

  it("supports create, version, clone, publish, unpublish and real instantiation in the UI", () => {
    for (const label of [
      "Create My Template", "Save immutable version", "Clone", "Submit", "Approve",
      "Request changes", "Publish", "Unpublish", "Create reconciliation",
    ]) expect(ui).toContain(label);
    expect(server).toContain("instantiateTenantTemplate");
  });

  it("keeps the owned-template view scannable with search, status and selected details", () => {
    expect(ui).toContain('scope.kind === "workspace" ? "installed" : "browse"');
    expect(ui).toContain('<TabsTrigger value="installed">My Templates</TabsTrigger>');
    expect(ui).toContain('aria-label="Search My Templates"');
    expect(ui).toContain('aria-label="Filter templates by status"');
    expect(ui).toContain('aria-label="Selected template details"');
    expect(ui).toContain('visibleTenantTemplates.find((row) => row.id === selectedTemplateId)');
    expect(ui).toContain("Current immutable version");
    expect(ui).toContain("No templates match these filters.");
    expect(ui).toContain("Templates could not be loaded.");
    expect(ui).toContain('onClick={() => tenantTplQ.refetch()}');
  });

  it("uses exact server paging and renders source-backed My Template columns", () => {
    expect(server).toContain("listTenantTemplatesPage");
    expect(server).toContain('{ count: "exact" }');
    expect(server).toContain(".range(from, to)");
    expect(server).toContain('.eq("tenant_id", data.tenant_id)');
    expect(ui).toContain('scope="col" className="p-3">Asset class');
    expect(ui).toContain('scope="col" className="p-3 text-right">Sides');
    expect(ui).toContain('scope="col" className="p-3">Owner');
    expect(ui).toContain('aria-label="Filter by asset class"');
    expect(ui).toContain('aria-label="My Templates rows per page"');
    expect(ui).not.toContain("visibleTenantTemplates = tenantTemplates.filter");
  });

  it("shows audit-backed lifecycle and only visible authorized run summaries without raw identities", () => {
    expect(server).toContain("getTenantTemplateLifecycle");
    expect(server).toContain("actor_recorded:");
    expect(server).toContain("getTenantTemplateLatestRun");
    expect(server).toContain(".eq(\"tenant_template_id\", data.tenant_template_id)");
    expect(server).toContain(".in(\"definition_id\", definitionIds)");
    expect(ui).toContain("Independently approved");
    expect(ui).toContain("actor recorded");
    expect(ui).toContain("Latest run");
    expect(ui).toContain("Run ID unavailable");
    expect(ui).not.toContain("run.run_uid || run.id");
    expect(ui).not.toContain("row.actor_id?.slice");
    expect(ui).not.toContain("row.entity_id?.slice");
  });
});
