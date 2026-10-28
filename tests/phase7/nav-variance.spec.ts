// Phase 7 — pure NAV variance math (mirrors recordNavRun logic so we can
// validate without DB round-trips).
import { describe, it, expect } from "vitest";

function navStatus(official: number, shadow: number, thresholdBps: number) {
  const bps = official === 0 ? 0 : ((shadow - official) / official) * 10_000;
  return { bps, status: Math.abs(bps) <= thresholdBps ? "passed" : "breached" as const };
}

describe("Shadow NAV variance", () => {
  it("passes when within bps threshold", () => {
    const { status, bps } = navStatus(100, 100.1, 25);
    expect(status).toBe("passed");
    expect(Math.round(bps)).toBe(10);
  });

  it("breaches when over bps threshold", () => {
    const { status } = navStatus(100, 100.5, 25);
    expect(status).toBe("breached");
  });

  it("treats zero official NAV defensively (no divide-by-zero)", () => {
    const { status, bps } = navStatus(0, 5, 25);
    expect(bps).toBe(0);
    expect(status).toBe("passed");
  });
});
