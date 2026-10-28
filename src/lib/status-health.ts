export type ProbeOutcome = "healthy" | "degraded" | "outage" | "maintenance";
export type EvidenceState = "healthy" | "degraded" | "outage" | "maintenance" | "unknown" | "stale";

export type StatusProbeSample = {
  environment_key: string;
  region_code: string | null;
  component_id: string;
  outcome: ProbeOutcome;
  checked_at: string;
  latency_ms: number | null;
};

export const STATUS_STALE_AFTER_MS = 5 * 60_000;

export function deriveEvidenceState(
  sample: StatusProbeSample | null | undefined,
  now = Date.now(),
  staleAfterMs = STATUS_STALE_AFTER_MS,
): EvidenceState {
  if (!sample) return "unknown";
  const checkedAt = Date.parse(sample.checked_at);
  if (!Number.isFinite(checkedAt) || checkedAt > now || now - checkedAt > staleAfterMs) return "stale";
  return sample.outcome;
}

/** Successful sampled checks are not wall-clock uptime. */
export function successfulCheckPercent(samples: readonly StatusProbeSample[]): number | null {
  if (samples.length === 0) return null;
  const valid = samples.filter((sample) => Number.isFinite(Date.parse(sample.checked_at)));
  if (valid.length === 0) return null;
  const healthy = valid.filter((sample) => sample.outcome === "healthy").length;
  return Math.round((healthy / valid.length) * 100_000) / 1_000;
}

export function probeCoverage(
  componentIds: readonly string[],
  latestSamples: readonly StatusProbeSample[],
  now = Date.now(),
): { covered: number; total: number; percent: number | null } {
  if (componentIds.length === 0) return { covered: 0, total: 0, percent: null };
  const fresh = new Set(latestSamples
    .filter((sample) => deriveEvidenceState(sample, now) !== "stale")
    .map((sample) => sample.component_id));
  const covered = componentIds.filter((id) => fresh.has(id)).length;
  return { covered, total: componentIds.length, percent: Math.round((covered / componentIds.length) * 1000) / 10 };
}
