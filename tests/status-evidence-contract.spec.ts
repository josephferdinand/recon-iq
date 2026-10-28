import { describe, it, expect } from "vitest";
import { measuredState, overallState, historyMeasurement, incidentDraftSchema, type StatusHealth } from "@/lib/status.model";
const now = Date.parse("2026-10-04T00:00:00Z");
const health = (change: Partial<StatusHealth> = {}): StatusHealth => ({ cell_key: "prod", component_key: "api", function_key: "api.read", function_label: "Read",
  availability: "deployed", probe_kind: "functional", expected_interval_seconds: 60, checked_at: new Date(now - 30_000).toISOString(), outcome: "healthy", latency_ms: 10, ...change });
const draft = () => ({ kind: "incident", severity: "major", status: "investigating", title: "Synthetic qualification event", summary: "Synthetic incident example for source validation only.", impact: null,
  cell_keys: ["production-current"], component_keys: ["api"], function_keys: [], started_at: "2025-01-01T00:00:00Z", detected_at: null, resolved_at: null,
  occurred_at: "2025-01-01T00:01:00Z", display_timezone: "UTC", correction_reason: null, root_cause: null, remediation: null, evidence_ref: "Synthetic evidence reference", public_safe: true });
describe("regional status measured evidence", () => {
  it("requires current functional coverage before operational status", () => {
    expect(measuredState(health(), now)).toBe("operational");
    expect(measuredState(health({ probe_kind: "availability" }), now)).toBe("unknown");
    expect(measuredState(health({ availability: "unverified" }), now)).toBe("unknown");
    expect(measuredState(health({ availability: "source_only" }), now)).toBe("not_available");
    expect(measuredState(health({ checked_at: null }), now)).toBe("unknown");
    expect(measuredState(health({ checked_at: new Date(now - 121_000).toISOString() }), now)).toBe("stale");
    expect(measuredState(health({ checked_at: new Date(now + 1).toISOString() }), now)).toBe("stale");
  });
  it("retains measured outages while incomplete scopes remain unknown", () => {
    expect(overallState(["unknown", "major_outage"], false)).toBe("major_outage");
    expect(overallState(["operational", "unknown"])).toBe("unknown");
    expect(overallState(["operational"], false)).toBe("unknown");
    expect(overallState([])).toBe("unknown");
    expect(overallState(["not_available"])).toBe("unknown");
  });
  it("computes uptime only from observed intervals, not sample counts or padded days", () => {
    const base = { cell_key: "prod", function_key: "api.read", sample_count: 5, healthy_count: 5, day: "2026-10-03", uptime_pct: null };
    expect(historyMeasurement([{ ...base, observed_seconds: 0, healthy_seconds: 0 }]).uptime_pct).toBeNull();
    expect(historyMeasurement([{ ...base, observed_seconds: 60, healthy_seconds: 30 }])).toMatchObject({ uptime_pct: 50, observed_seconds: 60, sampled_days: 1 });
  });
  it("validates historical dates, type/phase, time zone and independent public attestation", () => {
    expect(incidentDraftSchema.safeParse(draft()).success).toBe(true);
    for (const change of [{ resolved_at: "2024-01-01T00:00:00Z" }, { status: "resolved" }, { display_timezone: "not-a-zone" }, { public_safe: false }, { cell_keys: [] }, { kind: "maintenance" }]) {
      expect(incidentDraftSchema.safeParse({ ...draft(), ...change }).success).toBe(false);
    }
  });
  it("rejects personal identifiers, secrets and raw diagnostics in public text", () => {
    for (const summary of ["Contact jane@example.com for this incident", "Bearer fixture-secret-value", "api_key=fixture-only", "at handler (private.ts:20:10)"]) {
      expect(incidentDraftSchema.safeParse({ ...draft(), summary }).success).toBe(false);
    }
  });
});
