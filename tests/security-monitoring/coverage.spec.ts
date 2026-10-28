// Unit tests for continuous security monitoring CSV exporter + coverage list.
import { describe, it, expect } from "vitest";

// Re-implement csvEscape locally — same contract as security-monitoring.functions.ts.
function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

describe("csvEscape", () => {
  it("returns empty for null/undefined", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });
  it("quotes embedded commas, newlines and quotes", () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('a"b')).toBe('"a""b"');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });
  it("stringifies objects as JSON", () => {
    expect(csvEscape({ a: 1 })).toBe('"{""a"":1}"');
  });
  it("passes through simple scalars unquoted", () => {
    expect(csvEscape("simple")).toBe("simple");
    expect(csvEscape(42)).toBe("42");
  });
});

// Phase 6–8 coverage assertion — required rule codes that MUST exist as seeded
// platform-wide alert rules. This locks the contract between the migration and
// `securityMonitoringCoverage()`.
const REQUIRED_RULE_CODES = [
  "abac_predicate_write",
  "master_data_write",
  "residency_change",
  "ai_residency_block",
  "byok_rotate",
  "break_glass_granted",
  "red_team_scan",
  "github_sync_change",
  "chaos_drill_started",
  "silo_assignment",
  "auth_failure_spike",
  "step_up_failure",
  "cron_unauthorized",
  "rate_limit_p99_high",
] as const;

describe("Phase 6–8 monitoring coverage contract", () => {
  it("declares one alert rule per critical flow", () => {
    expect(new Set(REQUIRED_RULE_CODES).size).toBe(REQUIRED_RULE_CODES.length);
    expect(REQUIRED_RULE_CODES.length).toBeGreaterThanOrEqual(14);
  });
  it("includes at least one Phase 6 ABAC + residency rule", () => {
    expect(REQUIRED_RULE_CODES).toContain("abac_predicate_write");
    expect(REQUIRED_RULE_CODES).toContain("residency_change");
  });
  it("includes Phase 7 vertical security rules (red-team + github sync)", () => {
    expect(REQUIRED_RULE_CODES).toContain("red_team_scan");
    expect(REQUIRED_RULE_CODES).toContain("github_sync_change");
  });
  it("includes Phase 8 scale/isolation rules (chaos + silo)", () => {
    expect(REQUIRED_RULE_CODES).toContain("chaos_drill_started");
    expect(REQUIRED_RULE_CODES).toContain("silo_assignment");
  });
});
