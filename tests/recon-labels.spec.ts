import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { RECON_TYPE_LABELS, reconTypeLabel } from "../src/lib/recon-labels";

describe("reconciliation naming", () => {
  it("uses the owner-approved product names for every reconciliation mode", () => {
    expect(RECON_TYPE_LABELS).toEqual({
      one_sided: "Single Side Reconciliation",
      two_sided: "Two-Sided Reconciliation",
      three_sided: "Tri-Party Reconciliation",
    });
  });

  it("falls back safely for historical or future values", () => {
    expect(reconTypeLabel("one_sided")).toBe("Single Side Reconciliation");
    expect(reconTypeLabel("legacy_mode")).toBe("legacy_mode");
  });

  it("keeps the owner-approved source order and removes connection setup from the chooser", () => {
    const source = readFileSync("src/components/new-recon-wizard.tsx", "utf8");
    const start = source.indexOf("const SRC_TABS");
    const end = source.indexOf("];", start);
    const tabs = source.slice(start, end);
    const labels = ["UPLOAD FILE", "DATA PREP OUTPUT", "EXISTING DATA", "PASTE DATA"];
    expect(labels.map((label) => tabs.indexOf(label))).toEqual(
      [...labels.map((label) => tabs.indexOf(label))].sort((left, right) => left - right),
    );
    expect(tabs).not.toContain('label: "API"');
    expect(tabs).not.toContain('label: "DATABASE"');
    expect(tabs).not.toContain('label: "PDF"');
  });
});
