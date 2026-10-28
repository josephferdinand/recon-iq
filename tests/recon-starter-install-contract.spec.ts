import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260914210000_install_recon_starter_templates_atomically.sql",
  "utf8",
);
const server = readFileSync("src/lib/recon-templates.functions.ts", "utf8");
const ui = readFileSync("src/components/recon-templates-tab.tsx", "utf8");

describe("Starter Kit governed install contract", () => {
  it("installs the definition, provenance, counter and audit atomically", () => {
    expect(migration).toContain("install_recon_starter_template_atomic");
    expect(migration).toContain("starter_template_snapshot");
    expect(migration).toContain("install_count = install_count + 1");
    expect(migration).toContain("recon.template.install");
    expect(server).toContain('"install_recon_starter_template_atomic"');
  });

  it("validates active-tenant sources and service-supported rules", () => {
    expect(migration).toContain("source.tenant_id = _tenant_id");
    expect(migration).toContain("template source does not belong to tenant");
    expect(migration).toContain("template compiled an unsupported rule");
    expect(server).toContain("Mapped field");
  });

  it("requires visible leg and field mapping before browser installation", () => {
    expect(ui).toContain("Map sources &amp; install");
    expect(ui).toContain("Bind every template leg");
    expect(ui).toContain("Map a source column");
    expect(ui).toContain("Install runnable draft");
  });

  it("makes the published catalogue searchable and distinguishes same-title kits by code", () => {
    expect(ui).toContain('aria-label="Search Starter Kits"');
    expect(ui).toContain("setActiveCategory(category)");
    expect(ui).toContain("{template.code}");
    expect(ui).toContain("Asset-class presets and supported formats");
    expect(ui).toContain("CATEGORY_LABELS[category]");
    expect(ui).toContain("USER_FACING_ERRORS[userFacingErrorKind(error)]");
    expect(ui).not.toContain("toast.error(error.message)");
  });
});
