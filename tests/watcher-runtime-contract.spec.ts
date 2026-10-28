import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("watcher runtime convergence", () => {
  it("routes browser and scheduler evaluations through one tenant-scoped engine", async () => {
    const browser = await readFile("src/lib/watchers.functions.ts", "utf8");
    const scheduler = await readFile(
      "src/routes/api/public/cron/retention-and-watchers.ts",
      "utf8",
    );
    const service = await readFile("src/lib/watcher-evaluator.server.ts", "utf8");
    expect(browser).toContain("evaluateWatcherById");
    expect(scheduler).toContain("evaluateWatcherById");
    expect(scheduler).not.toContain("switch (full.watch_type)");
    expect(service).toContain('.eq("tenant_id", args.tenantId)');
    expect(service).toContain('if (!watcher.enabled) throw new Error("Watcher is disabled")');
    expect(service).toContain('trigger: "browser" | "api" | "schedule"');
  });

  it("makes all eleven watcher controls configurable in the Workspace", async () => {
    const ui = await readFile("src/components/watchers-tab.tsx", "utf8");
    for (const type of [
      "freshness",
      "raw_data",
      "row_count_delta",
      "schema_change",
      "dq_failure",
      "no_upload",
      "late_file",
      "duplicate_file",
      "filename_pattern",
      "control_total",
      "checksum_integrity",
    ])
      expect(ui).toContain(`"${type}"`);
    expect(ui).toContain("Repeat alert after (hours)");
    expect(ui).toContain("Regular expressions are not");
    expect(ui).toContain("accepted.");
    expect(ui).toContain("last_event.outcome_code");
    expect(ui).toContain("Watcher disabled; history retained");
    expect(ui).toContain("Quarantine source on alert");
  });
});
