import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("src/components/recon-templates-tab.tsx", "utf8");

describe("Starter Kits featured catalogue layout", () => {
  it("uses the actual published catalogue row for the featured kit and does not duplicate it below", () => {
    expect(source).toContain('template.code === "trade_lifecycle"');
    expect(source).toContain("?? visibleTemplates[0]");
    expect(source).toContain("if (template.id === featuredTemplate?.id || recommendedIds.has(template.id)) continue;");
    expect(source).toContain("{featuredTemplate.title}");
    expect(source).toContain("{featuredTemplate.summary");
  });

  it("shows source-backed setup readiness and keeps mapping actionable", () => {
    expect(source).toContain('aria-label="Setup checklist"');
    expect(source).toContain('aria-label="Expected outcomes"');
    expect(source).toContain("onClick={() => setInstalling({ ...featuredTemplate, summary: featuredTemplate.summary ?? undefined })}");
    expect(source).toContain("sourcesWithDetectedFields");
    expect(source).toContain("Checking tenant source availability");
    expect(source).toContain("Tenant sources could not be checked.");
    expect(source).toContain("Retry source check");
    expect(source).toContain("No tenant sources are available.");
    expect(source).toContain("Array.isArray(source?.inferred_schema)");
    expect(source).toContain("Counts are produced from tenant data by each reconciliation run.");
    expect(source).not.toContain("Not mapped");
    expect(source).not.toContain("After first run");
    expect(source).not.toContain("12,548 groups");
    expect(source).toContain('aria-label="Sort Starter Kits"');
    expect(source).toContain("View configuration");
    expect(source).toContain("recommendedTemplates.map(renderStarterCard)");
    expect(source).toContain("onCloseAutoFocus");
  });
});
