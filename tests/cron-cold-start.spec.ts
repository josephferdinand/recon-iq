import { describe, it, expect } from "vitest";
import { patternFiresAt, jobsLikelyMissedSince } from "@/lib/cron-trigger";

describe("R-2 cron cold-start diagnostic helpers", () => {
  it("patternFiresAt matches '30 3 * * *' at 03:30 UTC", () => {
    const t = new Date("2026-06-30T03:30:00Z");
    expect(patternFiresAt("30 3 * * *", t)).toBe(true);
    expect(patternFiresAt("30 3 * * *", new Date("2026-06-30T03:29:00Z"))).toBe(false);
  });

  it("patternFiresAt supports '*/5 * * * *'", () => {
    expect(patternFiresAt("*/5 * * * *", new Date("2026-06-30T03:05:00Z"))).toBe(true);
    expect(patternFiresAt("*/5 * * * *", new Date("2026-06-30T03:07:00Z"))).toBe(false);
  });

  it("jobsLikelyMissedSince flags an entry whose pattern fired within the last 5 min", () => {
    const now = new Date("2026-06-30T03:32:00Z");
    const missed = jobsLikelyMissedSince(
      [{ pattern: "30 3 * * *", name: "audit-anchor.verify" }],
      now,
      5,
    );
    expect(missed).toHaveLength(1);
    expect(missed[0].name).toBe("audit-anchor.verify");
    expect(missed[0].firedAt).toBe("2026-06-30T03:30:00.000Z");
  });

  it("jobsLikelyMissedSince returns empty when nothing should have fired", () => {
    const now = new Date("2026-06-30T03:32:00Z");
    const missed = jobsLikelyMissedSince(
      [{ pattern: "0 12 * * *", name: "daily-noon" }],
      now,
      5,
    );
    expect(missed).toHaveLength(0);
  });
});
