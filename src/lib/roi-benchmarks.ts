/**
 * ROI Estimator — cited industry benchmarks.
 * All values are indicative ranges, published in the UI so users can audit and edit them.
 */

export const ROI_BENCHMARKS = {
  fteFullyLoadedUsd: {
    low: 110_000,
    default: 140_000,
    high: 180_000,
    source: "Robert Half 2025 Finance & Accounting Salary Guide — Reconciliation Analyst bands (fully-loaded, US)",
  },
  productiveHoursPerYear: {
    default: 1_800,
    source: "Standard finance ops capacity: 45 productive weeks × 40 hrs",
  },
  legacyManualPct: {
    low: 0.55,
    default: 0.6,
    high: 0.7,
    source: "Deloitte 'Finance in a Digital World' and EY 2024 reconciliation survey",
  },
  breakRatePct: {
    low: 0.005,
    default: 0.015,
    high: 0.04,
    source: "Chartis RiskTech Reconciliation Solutions market study — cross-asset averages",
  },
  breakResolveMinutes: {
    low: 8,
    default: 12,
    high: 25,
    source: "Chartis RiskTech and Aite-Novarica reconciliation benchmarks",
  },
  currentAutoMatchPct: {
    legacy: 0.65,
    midMarket: 0.85,
    default: 0.75,
    source: "Industry survey composites (legacy on-prem 60–75%, mid-market 82–90%)",
  },
  fviAutoMatchPct: {
    low: 0.95,
    high: 0.99,
    note: "Target range — actual performance validated during POC on your data",
  },
  touchReductionOnBreaks: {
    default: 0.7,
    note: "Share of legacy break-investigation touch time removed by AI triage + copilot",
  },
  avgTouchMinutesPerMatch: {
    default: 0.35,
    note: "Analyst touch minutes per manually-matched transaction (queue triage + tagging)",
  },
  auditPrepHoursPerYear: {
    low: 200,
    default: 400,
    high: 800,
    source: "Mid-size financial-services firm; SOX 404 + internal audit evidence collation",
  },
  auditPrepReductionPct: {
    default: 0.75,
    note: "Hash-chained audit + one-click evidence export removes most collation work",
  },
  lateCloseIncidentUsd: {
    low: 25_000,
    default: 50_000,
    high: 250_000,
    source: "Analyst-cited cost per material late-close / restatement incident",
  },
  lateCloseIncidentsAvoidedPerYear: {
    default: 2,
    note: "Editable — set to 0 to exclude from the model",
  },
  annualPlatformCostUsd: {
    default: 240_000,
    note: "Indicative enterprise subscription. Actual pricing tailored during commercial discussion.",
  },
} as const;

export const ROI_SOURCES: Array<{ label: string; source: string }> = [
  { label: "Fully-loaded FTE cost", source: ROI_BENCHMARKS.fteFullyLoadedUsd.source },
  { label: "Manual-work share (legacy)", source: ROI_BENCHMARKS.legacyManualPct.source },
  { label: "Transaction break rate", source: ROI_BENCHMARKS.breakRatePct.source },
  { label: "Break resolution time", source: ROI_BENCHMARKS.breakResolveMinutes.source },
  { label: "Auto-match baselines", source: ROI_BENCHMARKS.currentAutoMatchPct.source },
  { label: "Audit evidence prep", source: ROI_BENCHMARKS.auditPrepHoursPerYear.source },
  { label: "Late-close incident cost", source: ROI_BENCHMARKS.lateCloseIncidentUsd.source },
];
