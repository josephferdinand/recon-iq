/**
 * Login-risk scoring — used by the auth pipeline to flag anomalies and, in
 * particular, "impossible travel" (a login from a location so far from the
 * previous login that a human could not have moved between them in the
 * elapsed time).
 *
 * Pure module — no I/O, no globals. Called from server functions that read
 * prior events from `public.login_anomaly_events` and write scored results
 * back.
 *
 * Pentest ref: P-M-02 (impossible-travel login rule).
 */

export interface LoginEventLocation {
  latitude: number;
  longitude: number;
  /** ISO-3166 alpha-2 country code. Optional; used for a secondary signal. */
  country?: string | null;
}

export interface LoginEvent {
  at: Date | string;
  ip: string | null;
  location: LoginEventLocation | null;
  userAgent?: string | null;
}

export interface LoginRiskInput {
  current: LoginEvent;
  /** Most recent prior successful login for this user, if any. */
  prior?: LoginEvent | null;
  /**
   * Maximum plausible ground speed in km/h (car ≈ 130, plane ≈ 900, plane +
   * connection ≈ 1000). Defaults to 1000 to avoid false positives for
   * back-to-back long-haul flights.
   */
  maxSpeedKmh?: number;
}

export interface LoginRiskResult {
  /** 0-100 composite score. */
  riskScore: number;
  /** Machine-readable reason codes. */
  reasons: string[];
  /** True if the two events are physically impossible for one human. */
  impossibleTravel: boolean;
  /** Recommended action: allow / step_up / block. */
  action: "allow" | "step_up" | "block";
}

const R_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Haversine distance in kilometres between two lat/long points. */
export function haversineKm(
  a: LoginEventLocation,
  b: LoginEventLocation,
): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Compute risk of a new login given the previous successful login.
 *
 * - No prior event → risk 0, "first_login" reason, allow.
 * - Same IP within a short window → risk 0.
 * - Impossible travel → risk 100, block.
 * - Country change without impossible travel → risk 40, step_up.
 * - Very fast travel that is possible but suspicious → risk 60, step_up.
 */
export function computeLoginRisk(input: LoginRiskInput): LoginRiskResult {
  const reasons: string[] = [];
  const { current, prior } = input;
  const maxSpeed = input.maxSpeedKmh ?? 1000;

  if (!prior) {
    return {
      riskScore: 0,
      reasons: ["first_login"],
      impossibleTravel: false,
      action: "allow",
    };
  }

  const currAt = new Date(current.at).getTime();
  const priorAt = new Date(prior.at).getTime();
  const deltaMin = Math.max(0, (currAt - priorAt) / 60_000);

  if (prior.ip && current.ip && prior.ip === current.ip && deltaMin < 60) {
    return {
      riskScore: 0,
      reasons: ["same_ip_recent"],
      impossibleTravel: false,
      action: "allow",
    };
  }

  let score = 0;
  let impossibleTravel = false;

  if (current.location && prior.location) {
    const distKm = haversineKm(prior.location, current.location);
    const hours = deltaMin / 60;
    // Guard against divide-by-zero: any distance in 0 minutes is impossible.
    const speedKmh = hours > 0 ? distKm / hours : distKm > 1 ? Infinity : 0;

    if (distKm > 50 && speedKmh > maxSpeed) {
      impossibleTravel = true;
      score = 100;
      reasons.push("impossible_travel");
      reasons.push(`distance_km:${Math.round(distKm)}`);
      reasons.push(`elapsed_min:${Math.round(deltaMin)}`);
    } else if (distKm > 50 && speedKmh > maxSpeed * 0.6) {
      score = Math.max(score, 60);
      reasons.push("very_fast_travel");
    }

    if (
      prior.location.country &&
      current.location.country &&
      prior.location.country !== current.location.country &&
      !impossibleTravel
    ) {
      score = Math.max(score, 40);
      reasons.push("country_change");
    }
  } else {
    reasons.push("geo_unavailable");
  }

  if (
    prior.userAgent &&
    current.userAgent &&
    prior.userAgent !== current.userAgent
  ) {
    score = Math.max(score, Math.min(score + 10, 55));
    reasons.push("user_agent_change");
  }

  const action: LoginRiskResult["action"] =
    score >= 100 ? "block" : score >= 40 ? "step_up" : "allow";

  return { riskScore: score, reasons, impossibleTravel, action };
}
