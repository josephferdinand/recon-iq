import { describe, expect, it } from "vitest";
import { dueReconCronMinutes, isValidReconCron, reconCronMatches } from "../src/lib/recon-cron";

describe("Recon Orchestrator cron", () => {
  it("accepts supported five-field expressions and rejects unsafe input", () => {
    expect(isValidReconCron("*/5 * * * *")).toBe(true);
    expect(isValidReconCron("0 6 * * 1-5")).toBe(true);
    expect(isValidReconCron("0 0 1,15 * *")).toBe(true);
    expect(isValidReconCron("60 * * * *")).toBe(false);
    expect(isValidReconCron("*/0 * * * *")).toBe(false);
    expect(isValidReconCron("0 6 * *")).toBe(false);
    expect(isValidReconCron("0 6 * * MON")).toBe(false);
  });

  it("uses standard day-of-month OR day-of-week behavior", () => {
    const mondayNotFirst = new Date("2026-09-14T06:00:00.000Z");
    const firstNotMonday = new Date("2026-10-01T06:00:00.000Z");
    expect(reconCronMatches("0 6 1 * 1", mondayNotFirst)).toBe(true);
    expect(reconCronMatches("0 6 1 * 1", firstNotMonday)).toBe(true);
  });

  it("recovers bounded missed occurrences after the exclusive cursor", () => {
    const due = dueReconCronMinutes(
      "*/5 * * * *",
      new Date("2026-09-14T10:01:00.000Z"),
      new Date("2026-09-14T10:18:59.000Z"),
      20,
    );
    expect(due.map((date) => date.toISOString())).toEqual([
      "2026-09-14T10:05:00.000Z",
      "2026-09-14T10:10:00.000Z",
      "2026-09-14T10:15:00.000Z",
    ]);
  });

  it("caps catch-up work per schedule", () => {
    const due = dueReconCronMinutes(
      "* * * * *",
      new Date("2026-09-14T10:00:00.000Z"),
      new Date("2026-09-14T11:00:00.000Z"),
      20,
    );
    expect(due).toHaveLength(20);
    expect(due.at(-1)?.toISOString()).toBe("2026-09-14T10:20:00.000Z");
  });
});
