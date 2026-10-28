import { describe, expect, it } from "vitest";
import { GAP_COUNT, GAP_ITEMS, getGapEvidenceStatus } from "@/lib/gap-closure.registry";

describe("Gap Closure evidence status", () => {
  it("derives status from registered evidence instead of roadmap claims", () => {
    const counts = GAP_ITEMS.reduce<Record<string, number>>((result, item) => {
      const status = getGapEvidenceStatus(item);
      result[status] = (result[status] ?? 0) + 1;
      return result;
    }, {});

    expect(GAP_COUNT).toBe(41);
    expect(counts).toEqual({ catalogued: 32, verified: 2, wired: 7 });
  });

  it("requires a concrete reference for every registered evidence item", () => {
    for (const item of GAP_ITEMS) {
      for (const evidence of item.evidence) {
        expect(evidence.ref.trim()).not.toBe("");
        expect(evidence.note.trim()).not.toBe("");
      }
    }
  });

  it("never promotes a catalogue-only item to a delivery status", () => {
    const invoice = GAP_ITEMS.find((item) => item.id === "invoices");
    const passwordPolicy = GAP_ITEMS.find((item) => item.id === "password-policy");
    const themePalettes = GAP_ITEMS.find((item) => item.id === "theme-palettes");

    expect(invoice && getGapEvidenceStatus(invoice)).toBe("catalogued");
    expect(passwordPolicy && getGapEvidenceStatus(passwordPolicy)).toBe("verified");
    expect(themePalettes && getGapEvidenceStatus(themePalettes)).toBe("wired");
  });
});
