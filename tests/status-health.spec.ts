import { describe, expect, it } from "vitest";
import { deriveEvidenceState, successfulCheckPercent, probeCoverage, type StatusProbeSample } from "@/lib/status-health";

const now = Date.parse("2026-10-03T00:00:00.000Z");
const sample = (overrides: Partial<StatusProbeSample> = {}): StatusProbeSample => ({
  environment_key: "production", region_code: null, component_id: "api", outcome: "healthy",
  checked_at: new Date(now - 60_000).toISOString(), latency_ms: 42, ...overrides,
});

describe("status evidence", () => {
  it("keeps missing, invalid, future, and old samples out of healthy state", () => {
    expect(deriveEvidenceState(null, now)).toBe("unknown");
    expect(deriveEvidenceState(sample({ checked_at: "not-a-time" }), now)).toBe("stale");
    expect(deriveEvidenceState(sample({ checked_at: new Date(now + 1).toISOString() }), now)).toBe("stale");
    expect(deriveEvidenceState(sample({ checked_at: new Date(now - 6 * 60_000).toISOString() }), now)).toBe("stale");
  });

  it("counts successful measured checks without claiming wall-clock uptime", () => {
    expect(successfulCheckPercent([])).toBeNull();
    expect(successfulCheckPercent([sample(), sample({ outcome: "outage" })])).toBe(50);
  });

  it("counts coverage from fresh samples only", () => {
    expect(probeCoverage(["api", "auth"], [sample()], now)).toEqual({ covered: 1, total: 2, percent: 50 });
    expect(probeCoverage(["api"], [sample({ checked_at: new Date(now - 10 * 60_000).toISOString() })], now))
      .toEqual({ covered: 0, total: 1, percent: 0 });
    expect(probeCoverage([], [], now).percent).toBeNull();
  });
});
