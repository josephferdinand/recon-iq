/**
 * Phase 8 — quarterly chaos drill cadence helper.
 */
import { describe, it, expect } from "vitest";
import { nextQuarterlyDrillDate } from "@/lib/phase8-chaos-drills.functions";

describe("nextQuarterlyDrillDate", () => {
  it("falls 3 months after last drill", () => {
    const last = "2026-01-15T00:00:00.000Z";
    const out = nextQuarterlyDrillDate(last, new Date("2026-02-01T00:00:00.000Z"));
    expect(out).toBe("2026-04-15T00:00:00.000Z");
  });
  it("falls 3 months from now when no prior drill", () => {
    const now = new Date("2026-06-30T00:00:00.000Z");
    expect(nextQuarterlyDrillDate(null, now)).toBe("2026-09-30T00:00:00.000Z");
  });
  it("uses now if last drill is older than now", () => {
    const last = "2025-01-01T00:00:00.000Z";
    const now = new Date("2026-06-30T00:00:00.000Z");
    expect(nextQuarterlyDrillDate(last, now)).toBe("2026-09-30T00:00:00.000Z");
  });
});
