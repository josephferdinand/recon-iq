import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("shared selected-row theme adoption", () => {
  it("applies the shared treatment only to selected Watchers and Reference Data rows", () => {
    const watchers = read("src/components/watchers-tab.tsx");
    const referenceData = read("src/components/reference-data-tab.tsx");

    expect(watchers).toContain('selected?.id === w.id ? "fvi-selected-row"');
    expect(watchers).toContain('aria-selected={selected?.id === w.id}');
    expect(watchers).toContain('aria-pressed={selected?.id === w.id}');
    expect(referenceData).toContain('isSel ? "fvi-selected-row"');
    expect(referenceData).toContain("aria-selected={isSel}");
    expect(referenceData).toContain('isSel ? "text-[var(--fvi-selected-row-fg)]" : "text-primary"');
    expect(referenceData).toContain('isSel ? "text-[var(--fvi-selected-row-fg)]" : "text-accent-foreground"');
  });

  it("applies the shared treatment to selected Data Prep and My Templates records", () => {
    const dataPrep = read("src/components/data-prep-tab.tsx");
    const templates = read("src/components/template-marketplace.tsx");

    expect(dataPrep).toContain('selectedPipeline?.id === p.id ? "fvi-selected-row"');
    expect(dataPrep).toContain("aria-selected={selectedPipeline?.id === p.id}");
    expect(dataPrep).toContain('"bg-transparent text-[var(--fvi-selected-row-fg)] hover:bg-transparent"');
    expect(dataPrep).toContain("<StatusBadge status={p.status} />");
    expect(templates).toContain('selectedTenantTemplate?.id === row.id ? "fvi-selected-row"');
    expect(templates).toContain('aria-current={selectedTenantTemplate?.id === row.id ? "true" : undefined}');
  });

  it("applies the shared treatment to selected Connections", () => {
    const connections = read("src/components/connectors-tab.tsx");
    expect(connections).toContain('aria-selected={isSelected} className={`border-t ${isSelected ? "fvi-selected-row"');
    expect(connections).not.toContain('isSelected ? "bg-primary/5"');
  });

  it("uses the shared selected-row View affordance in all four resource tables", () => {
    for (const path of ["src/components/data-sources-tab.tsx", "src/components/connectors-tab.tsx", "src/components/watchers-tab.tsx", "src/components/data-prep-tab.tsx"]) {
      expect(read(path), path).toContain('className="fvi-row-view-action"');
    }
  });
});
