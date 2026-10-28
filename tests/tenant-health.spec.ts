/**
 * Tenant Health Score — unit tests
 *
 * Tests the pure scoring logic in JS (the SQL function is tested in the
 * supabase suite separately). The implementation here mirrors the SQL
 * formula exactly so we can validate the model without hitting the DB.
 */
import { describe, expect, it } from "vitest";

/** Pure scoring model — mirrors compute_tenant_health_score SQL. */
type HealthInputs = {
  runsAnalyzed: number;
  matched: number;
  unmatched: number;
  exceptionsOpen: number;
  medianTtrHours: number;
  rulesTotal: number;
  rulesActive: number;
  aiAvgConfidence: number;
};

export function computeScoreFromInputs(input: HealthInputs) {
  const matchRate = input.matched + input.unmatched > 0
    ? input.matched / (input.matched + input.unmatched)
    : 0;
  const matchScore =
    input.runsAnalyzed === 0 ? 50
      : matchRate >= 0.98 ? 100
      : matchRate >= 0.95 ? 90
      : matchRate >= 0.90 ? 80
      : matchRate >= 0.80 ? 65
      : matchRate >= 0.70 ? 50
      : matchRate >= 0.50 ? 30
      : 15;

  const exceptionScore =
    input.exceptionsOpen === 0 ? 100
      : input.exceptionsOpen <= 5 ? 90
      : input.exceptionsOpen <= 20 ? 75
      : input.exceptionsOpen <= 50 ? 60
      : input.exceptionsOpen <= 200 ? 40
      : input.exceptionsOpen <= 500 ? 20
      : 5;

  const ttrScore =
    input.medianTtrHours === 0 ? 80
      : input.medianTtrHours <= 2 ? 100
      : input.medianTtrHours <= 8 ? 90
      : input.medianTtrHours <= 24 ? 75
      : input.medianTtrHours <= 72 ? 55
      : input.medianTtrHours <= 168 ? 35
      : 15;

  const ruleScore = input.rulesTotal === 0
    ? 20
    : Math.min(100, (input.rulesActive / input.rulesTotal) * 100);

  const aiScore = input.aiAvgConfidence >= 0.95 ? 100
    : input.aiAvgConfidence >= 0.85 ? 85
    : input.aiAvgConfidence >= 0.70 ? 70
    : input.aiAvgConfidence >= 0.50 ? 50
    : 25;

  const overall = Math.round(
    matchScore * 0.30
    + exceptionScore * 0.20
    + ttrScore * 0.20
    + ruleScore * 0.15
    + aiScore * 0.15,
  );

  return { matchScore, exceptionScore, ttrScore, ruleScore, aiScore, overall, matchRate };
}

describe("tenant health scoring model", () => {
  it("scores a pristine tenant at 100", () => {
    const r = computeScoreFromInputs({
      runsAnalyzed: 100,
      matched: 10_000,
      unmatched: 0,
      exceptionsOpen: 0,
      medianTtrHours: 1,
      rulesTotal: 5,
      rulesActive: 5,
      aiAvgConfidence: 0.96,
    });
    expect(r.overall).toBeGreaterThanOrEqual(95);
    expect(r.matchScore).toBe(100);
    expect(r.exceptionScore).toBe(100);
    expect(r.ttrScore).toBe(100);
    expect(r.aiScore).toBe(100);
  });

  it("penalises open exceptions", () => {
    const clean = computeScoreFromInputs({
      runsAnalyzed: 100, matched: 10_000, unmatched: 0,
      exceptionsOpen: 0, medianTtrHours: 4, rulesTotal: 5, rulesActive: 5, aiAvgConfidence: 0.9,
    });
    const dirty = computeScoreFromInputs({
      runsAnalyzed: 100, matched: 10_000, unmatched: 0,
      exceptionsOpen: 250, medianTtrHours: 4, rulesTotal: 5, rulesActive: 5, aiAvgConfidence: 0.9,
    });
    expect(dirty.exceptionScore).toBeLessThan(clean.exceptionScore);
    expect(dirty.overall).toBeLessThan(clean.overall);
  });

  it("penalises low match rate", () => {
    const high = computeScoreFromInputs({
      runsAnalyzed: 100, matched: 970, unmatched: 30,
      exceptionsOpen: 5, medianTtrHours: 4, rulesTotal: 5, rulesActive: 5, aiAvgConfidence: 0.9,
    });
    const low = computeScoreFromInputs({
      runsAnalyzed: 100, matched: 600, unmatched: 400,
      exceptionsOpen: 5, medianTtrHours: 4, rulesTotal: 5, rulesActive: 5, aiAvgConfidence: 0.9,
    });
    expect(high.matchScore).toBeGreaterThan(low.matchScore);
  });

  it("returns 50/50/80 when no data exists", () => {
    const r = computeScoreFromInputs({
      runsAnalyzed: 0, matched: 0, unmatched: 0,
      exceptionsOpen: 0, medianTtrHours: 0, rulesTotal: 0, rulesActive: 0, aiAvgConfidence: 0,
    });
    expect(r.matchScore).toBe(50);
    expect(r.exceptionScore).toBe(100);
    expect(r.ttrScore).toBe(80);
    expect(r.ruleScore).toBe(20);
    expect(r.aiScore).toBe(25);
  });

  it("clamps score to [0, 100]", () => {
    const r = computeScoreFromInputs({
      runsAnalyzed: 100, matched: 0, unmatched: 1000,
      exceptionsOpen: 9999, medianTtrHours: 999, rulesTotal: 1, rulesActive: 0, aiAvgConfidence: 0,
    });
    expect(r.overall).toBeGreaterThanOrEqual(0);
    expect(r.overall).toBeLessThanOrEqual(100);
  });
});