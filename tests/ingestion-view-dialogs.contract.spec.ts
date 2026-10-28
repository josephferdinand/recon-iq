import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function dialogSource(path: string, marker: string) {
  const source = await readFile(path, "utf8");
  const start = source.indexOf(marker);
  const end = source.indexOf("</Dialog>", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return { source, dialog: source.slice(start, end) };
}

describe("ingestion View dialog content", () => {
  it("keeps the file upload split view organized without repeating Public ID", async () => {
    const { dialog } = await dialogSource("src/components/data-sources-tab.tsx", "<Dialog open={Boolean(viewSourceId)}");
    const rail = dialog.split("railFields={[")[1]?.split("]}")[0] ?? "";
    expect(dialog).toContain("<FviDetailDialogLayout");
    expect(rail).not.toContain("Public ID");
    expect(rail).toContain("Last updated");
    expect(dialog).toContain('aria-label="Identity and access"');
    expect(dialog).toContain("ResourceIdentitySummary mode=\"detail\"");
    expect(dialog).toContain("ResourceActorSummaryView mode=\"detail\"");
    expect(dialog).toContain('aria-label="Schema"');
    expect(dialog).toContain('aria-label="Recent upload history"');
    expect(dialog).toContain("Upload file");
    expect(dialog).toContain("Archive");
  });

  it("keeps connection facts distinct and states missing attempt timestamps honestly", async () => {
    const { source, dialog } = await dialogSource("src/components/connectors-tab.tsx", "<Dialog open={Boolean(viewId)}");
    const rail = dialog.split("railFields={[")[1]?.split("]}")[0] ?? "";
    expect(dialog).toContain("<FviDetailDialogLayout");
    expect(rail).toContain("Type");
    expect(rail).not.toContain("Public ID");
    expect(rail).not.toContain("Schedule");
    expect(rail).not.toContain("Last attempt");
    expect(dialog).toContain('aria-label="Identity and access"');
    expect(dialog).toContain('aria-label="Schedule and execution"');
    expect(dialog).toContain('aria-label="Last attempt"');
    expect(dialog).not.toContain("No attempt recorded");
    expect(source).toContain("No attempt timestamp is recorded.");
    expect(source).toContain("A stored connection error is present; its attempt time is unavailable.");
    expect(source).toContain("Review History for attempt context.");
    expect(dialog).toContain(">History</Button>");
    expect(dialog).toContain(">Edit</Button>");
  });

  it("groups watcher identity, monitoring rule, and latest state without duplicating rail fields", async () => {
    const { dialog } = await dialogSource("src/components/watchers-tab.tsx", "<Dialog open={Boolean(viewId)}");
    const rail = dialog.split("railFields={[")[1]?.split("]}")[0] ?? "";
    expect(dialog).toContain("<FviDetailDialogLayout");
    expect(rail).toContain("Severity");
    expect(rail).not.toContain("Public ID");
    expect(rail).not.toContain("Source");
    expect(rail).not.toContain("Last check");
    expect(dialog).toContain('aria-label="Identity and access"');
    expect(dialog).toContain('aria-label="Monitoring rule"');
    expect(dialog).toContain('aria-label="Latest status and history"');
    expect(dialog).toContain("No check has been executed yet.");
    expect(dialog).toContain(">Evaluate</Button>");
  });
});
