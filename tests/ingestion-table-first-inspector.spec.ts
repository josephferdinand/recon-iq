import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const paths = [
  "src/components/data-sources-tab.tsx",
  "src/components/connectors-tab.tsx",
  "src/components/watchers-tab.tsx",
];

describe("ingestion table-first inspector contract", () => {
  it("starts collapsed and exposes a labelled, keyboard dismissible inspector on every list", async () => {
    for (const path of paths) {
      const source = await readFile(path, "utf8");
      expect(source).toContain("useState(false)");
      expect(source).toContain('aria-controls=');
      expect(source).toContain('aria-expanded={detailsVisible}');
      expect(source).toContain('{detailsPinned ? "Hide details" : "Show details"}');
      expect(source).toContain('event.key === "Escape"');
      expect(source).toContain("onMouseEnter={showDetailsPreview}");
      expect(source).toContain("onFocus={showDetailsPreview}");
      expect(source).toContain("ref={detailsToolbarRef}");
      expect(source).toContain("getBoundingClientRect()");
      expect(source).toContain("onMouseLeave={scheduleDetailsPreviewClose}");
      expect(source).toContain("onBlur={scheduleDetailsPreviewClose}");
      expect(source).toContain("setTimeout(() => setDetailsPreview(false), 180)");
      expect(source).toContain("return () => clearDetailsPreviewClose();");
      expect(source).toContain('aria-controls=');
      expect(source).toContain("Selected:");
      expect(source).not.toContain('className="fixed right-0 top-1/2');
      expect(source).toContain("Additional filters (unavailable)");
      expect(source).toContain('aria-label="Search by Public ID"');
      expect(source).toContain('disabled={accessQ.data?.available !== true}');
      expect(source).toContain('aria-label="Updated from date (UTC)"');
      expect(source).toContain('aria-label="Updated through date (UTC)"');
      expect(source).toContain('aria-label="Filter by business unit unavailable"');
      expect(source).toContain('aria-label="Filter by user group unavailable"');
    }
  });

  it("keeps each View column sticky and does not attribute edits to an unsupported actor", async () => {
    const [sources, connectors, watchers] = await Promise.all(paths.map((path) => readFile(path, "utf8")));
    const actorView = await readFile("src/components/resource-actor-summary.tsx", "utf8");
    for (const source of [sources, connectors, watchers]) {
      expect(source).toContain("fvi-sticky-view-cell");
    }
    expect(actorView).toContain('"Editor unavailable"');
    expect(sources).toContain("<span className=\"block\">{formatTimestamp(source.updated_at)}</span>");
    for (const [source, resourceType] of [[sources, '"data_source"'], [connectors, '"data_source_schedule"'], [watchers, '"file_watcher"']] as const) {
      expect(source).toContain("getResourceActorSummaries");
      expect(source).toContain(`resource_type: ${resourceType}`);
      expect(source).toContain("resource_ids:");
      expect(source).toContain("<= 100");
      expect(source).toContain('mode="updated-line"');
      expect(source).toContain('mode="detail"');
      expect(source).toContain("ResourceActorSummaryView");
    }
    expect(sources).not.toContain("Editor unavailable");
  });

  it("invalidates actor summaries after every resource-changing mutation", async () => {
    const [sources, connectors, watchers] = await Promise.all(paths.map((path) => readFile(path, "utf8")));
    expect(sources.match(/invalidateActorSummaries\(\)/g)).toHaveLength(4); // create, delete, archive, upload
    expect(connectors.match(/invalidateActorSummaries\(\)/g)).toHaveLength(3); // save, delete, run settled
    expect(watchers.match(/invalidateActorSummaries\(\)/g)).toHaveLength(3); // save, disable, evaluate
    for (const [source, resourceType] of [[sources, "data_source"], [connectors, "data_source_schedule"], [watchers, "file_watcher"]] as const) {
      expect(source).toContain(`queryKey: ["resource-actor-summary", tenantId, "${resourceType}"] });`);
    }
  });
});
