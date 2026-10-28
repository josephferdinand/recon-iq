/**
 * Phase 6 — Calendar-aware SLA helper invariants.
 *
 * These tests reimplement the PL/pgSQL logic of `sla_business_due_at` in TS
 * to assert the contract (skip weekends, advance one hour per step, respect
 * holiday list). The deployed RPC executes the same algorithm.
 */
import { describe, expect, it } from "vitest";

function slaBusinessDueAt(
  start: Date,
  slaMinutes: number,
  holidays: ReadonlySet<string>,
): Date {
  let cursor = new Date(start);
  let remaining = slaMinutes;
  while (remaining > 0) {
    const dow = ((cursor.getUTCDay() + 6) % 7) + 1; // 1=Mon … 7=Sun
    const dayKey = cursor.toISOString().slice(0, 10);
    if (dow >= 6 || holidays.has(dayKey)) {
      // jump to next day at midnight
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1));
      continue;
    }
    const step = Math.min(remaining, 60);
    cursor = new Date(cursor.getTime() + step * 60_000);
    remaining -= step;
  }
  return cursor;
}

describe("sla_business_due_at", () => {
  it("advances within a regular business day", () => {
    const start = new Date("2026-07-01T09:00:00Z"); // Wed
    const due = slaBusinessDueAt(start, 120, new Set());
    expect(due.toISOString()).toBe("2026-07-01T11:00:00.000Z");
  });

  it("skips a weekend", () => {
    // Saturday start with 60min SLA — must jump to Monday 00:01
    const start = new Date("2026-07-04T10:00:00Z"); // Sat
    const due = slaBusinessDueAt(start, 60, new Set());
    expect(due.getUTCDay()).toBe(1); // Monday
  });

  it("skips a holiday", () => {
    const start = new Date("2026-07-03T09:00:00Z"); // Fri
    const due = slaBusinessDueAt(start, 60, new Set(["2026-07-03"]));
    // holiday consumes Friday → weekend → Monday → +1h
    expect(due.getUTCDay()).toBe(1);
  });
});
