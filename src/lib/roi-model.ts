/**
 * ROI Estimator — pure calculation model.
 * Deterministic, side-effect free, safe to import on client and server.
 * Every output is INDICATIVE — see roi-benchmarks.ts for source citations.
 */

import { ROI_BENCHMARKS as B } from "./roi-benchmarks";

export interface RoiInputs {
  /** Monthly transactions across all reconciliations */
  monthlyTxnVolume: number;
  /** % of transactions that break, 0–1 */
  breakRate: number;
  /** Average minutes an analyst spends resolving one break */
  breakResolveMinutes: number;
  /** Reconciliation FTE headcount */
  fteCount: number;
  /** Fully-loaded USD per FTE per year */
  fteFullyLoadedUsd: number;
  /** Current auto-match rate today, 0–1 */
  currentAutoMatchPct: number;
  /** ReconIQ target auto-match rate, low end, 0–1 */
  fviAutoMatchLow: number;
  /** ReconIQ target auto-match rate, high end, 0–1 */
  fviAutoMatchHigh: number;
  /** Analyst touch minutes per manually-matched transaction */
  avgTouchMinutesPerMatch: number;
  /** Share of break-investigation touch time removed by AI triage, 0–1 */
  touchReductionOnBreaks: number;
  /** Audit evidence prep hours per year */
  auditPrepHoursPerYear: number;
  /** Share of audit prep time removed, 0–1 */
  auditPrepReductionPct: number;
  /** USD cost of one material late-close or restatement incident */
  lateCloseIncidentUsd: number;
  /** Incidents avoided per year */
  lateCloseIncidentsAvoidedPerYear: number;
  /** Indicative platform cost per year, USD */
  annualPlatformCostUsd: number;
}

export const ROI_DEFAULTS: RoiInputs = {
  monthlyTxnVolume: 500_000,
  breakRate: B.breakRatePct.default,
  breakResolveMinutes: B.breakResolveMinutes.default,
  fteCount: 8,
  fteFullyLoadedUsd: B.fteFullyLoadedUsd.default,
  currentAutoMatchPct: B.currentAutoMatchPct.default,
  fviAutoMatchLow: B.fviAutoMatchPct.low,
  fviAutoMatchHigh: B.fviAutoMatchPct.high,
  avgTouchMinutesPerMatch: B.avgTouchMinutesPerMatch.default,
  touchReductionOnBreaks: B.touchReductionOnBreaks.default,
  auditPrepHoursPerYear: B.auditPrepHoursPerYear.default,
  auditPrepReductionPct: B.auditPrepReductionPct.default,
  lateCloseIncidentUsd: B.lateCloseIncidentUsd.default,
  lateCloseIncidentsAvoidedPerYear: B.lateCloseIncidentsAvoidedPerYear.default,
  annualPlatformCostUsd: B.annualPlatformCostUsd.default,
};

export interface RoiScenario {
  matchHoursSavedYr: number;
  breakHoursSavedYr: number;
  auditHoursSavedYr: number;
  totalHoursSavedYr: number;
  laborSavingsYr: number;
  incidentSavingsYr: number;
  totalSavingsYr: number;
  fteEquivalentFreed: number;
  paybackMonths: number;
  netSavingsYr: number;
  roiMultiple: number;
}

export interface RoiOutputs {
  low: RoiScenario;
  mid: RoiScenario;
  high: RoiScenario;
  derived: {
    hourlyCost: number;
    txnsYr: number;
    breaksNowYr: number;
    breakHoursNowYr: number;
    currentCapacityHoursYr: number;
  };
}

function scenarioFor(fviMatch: number, inp: RoiInputs, hourlyCost: number, txnsYr: number, breakHoursNowYr: number): RoiScenario {
  const lift = Math.max(0, fviMatch - inp.currentAutoMatchPct);
  const matchHoursSavedYr = txnsYr * lift * (inp.avgTouchMinutesPerMatch / 60);
  const breakHoursSavedYr = breakHoursNowYr * inp.touchReductionOnBreaks;
  const auditHoursSavedYr = inp.auditPrepHoursPerYear * inp.auditPrepReductionPct;
  const totalHoursSavedYr = matchHoursSavedYr + breakHoursSavedYr + auditHoursSavedYr;

  const laborSavingsYr = totalHoursSavedYr * hourlyCost;
  const incidentSavingsYr = inp.lateCloseIncidentsAvoidedPerYear * inp.lateCloseIncidentUsd;
  const totalSavingsYr = laborSavingsYr + incidentSavingsYr;

  const fteEquivalentFreed = totalHoursSavedYr / B.productiveHoursPerYear.default;
  const netSavingsYr = totalSavingsYr - inp.annualPlatformCostUsd;
  const roiMultiple = inp.annualPlatformCostUsd > 0 ? totalSavingsYr / inp.annualPlatformCostUsd : 0;
  const paybackMonths = totalSavingsYr > 0 ? (inp.annualPlatformCostUsd / totalSavingsYr) * 12 : Number.POSITIVE_INFINITY;

  return {
    matchHoursSavedYr,
    breakHoursSavedYr,
    auditHoursSavedYr,
    totalHoursSavedYr,
    laborSavingsYr,
    incidentSavingsYr,
    totalSavingsYr,
    fteEquivalentFreed,
    paybackMonths,
    netSavingsYr,
    roiMultiple,
  };
}

export function computeRoi(inp: RoiInputs): RoiOutputs {
  const hourlyCost = inp.fteFullyLoadedUsd / B.productiveHoursPerYear.default;
  const txnsYr = inp.monthlyTxnVolume * 12;
  const breaksNowYr = txnsYr * inp.breakRate;
  const breakHoursNowYr = breaksNowYr * (inp.breakResolveMinutes / 60);
  const currentCapacityHoursYr = inp.fteCount * B.productiveHoursPerYear.default;

  const mid = (inp.fviAutoMatchLow + inp.fviAutoMatchHigh) / 2;

  return {
    low: scenarioFor(inp.fviAutoMatchLow, inp, hourlyCost, txnsYr, breakHoursNowYr),
    mid: scenarioFor(mid, inp, hourlyCost, txnsYr, breakHoursNowYr),
    high: scenarioFor(inp.fviAutoMatchHigh, inp, hourlyCost, txnsYr, breakHoursNowYr),
    derived: { hourlyCost, txnsYr, breaksNowYr, breakHoursNowYr, currentCapacityHoursYr },
  };
}

/* URL query-string share helpers */

const KEYS: Array<keyof RoiInputs> = [
  "monthlyTxnVolume", "breakRate", "breakResolveMinutes", "fteCount", "fteFullyLoadedUsd",
  "currentAutoMatchPct", "fviAutoMatchLow", "fviAutoMatchHigh", "avgTouchMinutesPerMatch",
  "touchReductionOnBreaks", "auditPrepHoursPerYear", "auditPrepReductionPct",
  "lateCloseIncidentUsd", "lateCloseIncidentsAvoidedPerYear", "annualPlatformCostUsd",
];

export function inputsToQuery(inp: RoiInputs): string {
  const p = new URLSearchParams();
  for (const k of KEYS) p.set(k, String(inp[k]));
  return p.toString();
}

export function inputsFromQuery(search: string): RoiInputs {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const out: RoiInputs = { ...ROI_DEFAULTS };
  for (const k of KEYS) {
    const v = p.get(k);
    if (v == null) continue;
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

/* Formatting helpers */

export function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

export function fmtHrs(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return Math.round(n).toLocaleString();
}

export function fmtPct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtMonths(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 1) return "< 1 mo";
  if (n > 60) return "> 5 yrs";
  return `${n.toFixed(1)} mo`;
}
