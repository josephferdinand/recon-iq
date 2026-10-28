/**
 * Exception Forecast — pure unit tests for the heuristic model.
 *
 * Mirrors predict_next_exception_volume logic so we can validate edge cases
 * (no history, anomaly spike, weekend dip) without hitting the DB.
 */
import { describe, expect, it } from "vitest";

type DailyCounts = Array<{ date: Date; count: number }>;

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Pure predictor — mirrors SQL implementation */
export function forecastFromHistory(history: DailyCounts, horizon: number, asOf: Date = new Date()) {
  const counts = history.map((h) => h.count);
  const baselineMean = counts.length === 0 ? 0 : counts.reduce((a, b) => a + b, 0) / counts.length;
  const baselineStddev = stddev(counts);
  const rollingMedian = median(counts);

  // DOW means over last 28 days
  const dowMeans: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  history.forEach((h) => {
    if (Math.abs(asOf.getTime() - h.date.getTime()) <= 28 * 86_400_000) {
      dowMeans[h.date.getDay()].push(h.count);
    }
  });

  const dowFactor: Record<number, number> = {};
  for (let d = 0; d < 7; d++) {
    const arr = dowMeans[d];
    if (arr.length > 0 && baselineMean > 0) {
      const m = arr.reduce((a, b) => a + b, 0) / arr.length;
      dowFactor[d] = Math.max(0.5, Math.min(1.5, m / baselineMean));
    } else {
      dowFactor[d] = 1.0;
    }
  }

  // Anomaly: last 3 days mean > 1.5 × rolling median
  const recent = counts.slice(-3);
  const recentMean = recent.length === 0 ? 0 : recent.reduce((a, b) => a + b, 0) / recent.length;
  const isAnomaly = rollingMedian > 0 && recentMean > rollingMedian * 1.5;
  const anomalyFactor = isAnomaly ? 1.5 : 1.0;

  const perDay: Array<{ date: string; expected: number; lower: number; upper: number; dow_factor: number }> = [];
  let sumExpected = 0, sumLower = 0, sumUpper = 0;
  for (let i = 0; i < horizon; i++) {
    const day = new Date(asOf);
    day.setDate(day.getDate() + i);
    const dow = day.getDay();
    const expected = Math.round(baselineMean * dowFactor[dow] * anomalyFactor * 10) / 10;
    const lower = Math.max(0, Math.round((expected - 1.96 * baselineStddev) * 10) / 10);
    const upper = Math.round((expected + 1.96 * baselineStddev) * 10) / 10;
    perDay.push({ date: day.toISOString().slice(0, 10), expected, lower, upper, dow_factor: dowFactor[dow] });
    sumExpected += expected;
    sumLower += lower;
    sumUpper += upper;
  }

  return {
    expected_count: sumExpected,
    lower_count: sumLower,
    upper_count: sumUpper,
    is_anomaly_active: isAnomaly,
    anomaly_factor: anomalyFactor,
    baseline_daily_mean: Math.round(baselineMean * 100) / 100,
    baseline_daily_stddev: Math.round(baselineStddev * 100) / 100,
    rolling_median_30d: Math.round(rollingMedian * 100) / 100,
    per_day: perDay,
  };
}

describe("exception forecast heuristic", () => {
  const asOf = new Date("2026-08-22T00:00:00Z");
  const dailyCounts = (counts: number[]): DailyCounts =>
    counts.map((c, i) => {
      const d = new Date(asOf);
      d.setDate(d.getDate() - (counts.length - 1 - i));
      return { date: d, count: c };
    });

  it("returns zeros for empty history", () => {
    const r = forecastFromHistory([], 7, asOf);
    expect(r.expected_count).toBe(0);
    expect(r.lower_count).toBe(0);
    expect(r.upper_count).toBe(0);
    expect(r.is_anomaly_active).toBe(false);
  });

  it("forecasts a flat baseline", () => {
    const r = forecastFromHistory(dailyCounts(Array(30).fill(10)), 7, asOf);
    // Expected ≈ 10 × 7 = 70 (allowing for DOW factor variation)
    expect(r.expected_count).toBeGreaterThanOrEqual(50);
    expect(r.expected_count).toBeLessThanOrEqual(90);
    expect(r.is_anomaly_active).toBe(false);
  });

  it("detects an anomaly spike in the last 3 days", () => {
    // 27 days at 10, last 3 at 30 — should be > 1.5× median
    const counts = Array(27).fill(10).concat([30, 30, 30]);
    const r = forecastFromHistory(dailyCounts(counts), 7, asOf);
    expect(r.is_anomaly_active).toBe(true);
    expect(r.anomaly_factor).toBe(1.5);
  });

  it("keeps DOW factor clamped to [0.5, 1.5]", () => {
    // Construct history where Saturday has 100× the average of weekdays.
    // We assert the per-day dow_factor column is clamped, not the post-anomaly ratio.
    const counts: number[] = [];
    for (let i = 0; i < 28; i++) {
      const d = new Date(asOf);
      d.setDate(d.getDate() - (28 - 1 - i));
      counts.push(d.getDay() === 6 ? 100 : 1);
    }
    const r = forecastFromHistory(dailyCounts(counts), 7, asOf);
    for (const day of r.per_day) {
      expect(day.dow_factor).toBeGreaterThanOrEqual(0.5);
      expect(day.dow_factor).toBeLessThanOrEqual(1.5);
    }
  });

  it("clamps lower bound at zero (no negative exceptions)", () => {
    const r = forecastFromHistory(dailyCounts([0, 0, 0, 0, 0, 1, 1]), 7, asOf);
    for (const day of r.per_day) {
      expect(day.lower).toBeGreaterThanOrEqual(0);
    }
  });
});