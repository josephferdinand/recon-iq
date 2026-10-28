import { describe, expect, it } from "vitest";
import { RECON_SCHEDULE_PRESETS } from "@/lib/recon-schedule-presets";
import { isValidReconCron } from "@/lib/recon-cron";

describe("reconciliation schedule cadence presets", () => {
  const presets = RECON_SCHEDULE_PRESETS.flatMap((group) => group.options);

  it("offers the requested recurring intervals with valid, unique UTC cron mappings", () => {
    expect(presets).toHaveLength(15);
    expect(new Set(presets.map(({ value }) => value)).size).toBe(presets.length);
    expect(presets.every(({ value }) => isValidReconCron(value))).toBe(true);
    expect(presets.map(({ label }) => label)).toEqual([
      "Every 5 minutes",
      "Every 10 minutes",
      "Every 15 minutes",
      "Every 30 minutes",
      "Hourly (on the hour)",
      "Every 2 hours (from 00:00 UTC)",
      "Every 3 hours (from 00:00 UTC)",
      "Every 6 hours (from 00:00 UTC)",
      "Every 12 hours (from 00:00 UTC)",
      "Daily at 06:00 UTC",
      "Daily at 18:00 UTC",
      "Weekdays at 09:00 UTC",
      "Weekly on Monday at 07:00 UTC",
      "Monthly on day 1 at 07:00 UTC",
      "Quarterly on Jan, Apr, Jul, Oct 1 at 07:00 UTC",
    ]);
    expect(presets.map(({ value }) => value)).toEqual([
      "*/5 * * * *",
      "*/10 * * * *",
      "*/15 * * * *",
      "*/30 * * * *",
      "0 * * * *",
      "0 */2 * * *",
      "0 */3 * * *",
      "0 */6 * * *",
      "0 */12 * * *",
      "0 6 * * *",
      "0 18 * * *",
      "0 9 * * 1-5",
      "0 7 * * 1",
      "0 7 1 * *",
      "0 7 1 1,4,7,10 *",
    ]);
  });

  it("groups cadence choices by interval type", () => {
    expect(RECON_SCHEDULE_PRESETS.map(({ group, options }) => [group, options.length])).toEqual([
      ["Minutes", 4],
      ["Hours", 5],
      ["Calendar", 6],
    ]);
  });
});
