import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("screen matrix accessibility regressions", () => {
  it("uses high-contrast processing and chaos score states", async () => {
    const [health, chaos, shards] = await Promise.all([
      readFile(
        new URL("../src/components/console/processing-health-overview.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/components/console/chaos-scorecard-panel.tsx", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../src/components/console/shards-panel.tsx", import.meta.url), "utf8"),
    ]);
    expect(health).toContain("text-emerald-800 dark:text-emerald-300");
    expect(health).not.toContain('tracking-wide opacity-70">score');
    expect(chaos).toContain("text-emerald-800 dark:text-emerald-300");
    expect(shards).toContain("text-emerald-800 dark:text-emerald-300");
  });

  it("names provider chart slices and vault icon actions", async () => {
    const [usage, vault] = await Promise.all([
      readFile(new URL("../src/routes/mkt-admin/ai-usage.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/routes/mkt-admin/vault.tsx", import.meta.url), "utf8"),
    ]);
    expect(usage).toContain("aria-label={`${p.name}: ${fmtUSD(p.value)}`}");
    expect(vault).toContain("aria-label={`Rotate ${String(row.name)}`}");
    expect(vault).toContain("aria-label={`Delete ${String(row.name)}`}");
  });
});
