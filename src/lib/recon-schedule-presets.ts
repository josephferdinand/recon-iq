export const RECON_SCHEDULE_PRESETS: { group: string; options: { label: string; value: string }[] }[] = [
  {
    group: "Minutes",
    options: [
      { label: "Every 5 minutes", value: "*/5 * * * *" },
      { label: "Every 10 minutes", value: "*/10 * * * *" },
      { label: "Every 15 minutes", value: "*/15 * * * *" },
      { label: "Every 30 minutes", value: "*/30 * * * *" },
    ],
  },
  {
    group: "Hours",
    options: [
      { label: "Hourly (on the hour)", value: "0 * * * *" },
      { label: "Every 2 hours (from 00:00 UTC)", value: "0 */2 * * *" },
      { label: "Every 3 hours (from 00:00 UTC)", value: "0 */3 * * *" },
      { label: "Every 6 hours (from 00:00 UTC)", value: "0 */6 * * *" },
      { label: "Every 12 hours (from 00:00 UTC)", value: "0 */12 * * *" },
    ],
  },
  {
    group: "Calendar",
    options: [
      { label: "Daily at 06:00 UTC", value: "0 6 * * *" },
      { label: "Daily at 18:00 UTC", value: "0 18 * * *" },
      { label: "Weekdays at 09:00 UTC", value: "0 9 * * 1-5" },
      { label: "Weekly on Monday at 07:00 UTC", value: "0 7 * * 1" },
      { label: "Monthly on day 1 at 07:00 UTC", value: "0 7 1 * *" },
      { label: "Quarterly on Jan, Apr, Jul, Oct 1 at 07:00 UTC", value: "0 7 1 1,4,7,10 *" },
    ],
  },
];

export const ALL_RECON_SCHEDULE_PRESETS = RECON_SCHEDULE_PRESETS.flatMap((group) => group.options);
