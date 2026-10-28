import { describe, it, expect } from "vitest";

// Mirror of the delta_pct computation in recordDriftAlert.
function driftPct(baseline: number, observed: number): number | null {
  return baseline === 0 ? null : ((observed - baseline) / Math.abs(baseline)) * 100;
}

describe("upstream drift alert math", () => {
  it("computes positive drift", () => {
    expect(driftPct(100, 130)).toBe(30);
  });
  it("computes negative drift against negative baseline using abs", () => {
    expect(driftPct(-100, -50)).toBe(50);
  });
  it("returns null on zero baseline (defensive)", () => {
    expect(driftPct(0, 5)).toBeNull();
  });
});
