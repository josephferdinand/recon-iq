/**
 * Phase 8 — loan vertical haircut math.
 */
import { describe, it, expect } from "vitest";
import { effectiveCollateralValue } from "@/lib/phase8-loan-vertical.functions";

describe("effectiveCollateralValue", () => {
  it("applies a 5% haircut", () => {
    expect(effectiveCollateralValue(1000, 5)).toBe(950);
  });
  it("returns market value when haircut out of range", () => {
    expect(effectiveCollateralValue(1000, -1)).toBe(1000);
    expect(effectiveCollateralValue(1000, 101)).toBe(1000);
  });
  it("returns zero for 100% haircut", () => {
    expect(effectiveCollateralValue(1000, 100)).toBe(0);
  });
  it("rounds to 2 dp", () => {
    expect(effectiveCollateralValue(1234.567, 7.5)).toBe(1141.97);
  });
});
