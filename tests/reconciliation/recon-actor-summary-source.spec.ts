import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tabSource = readFileSync(new URL("../../src/components/recons-tab.tsx", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../../src/components/recon-studio-index.tsx", import.meta.url), "utf8");

describe("Rekon Studio actor summary integration", () => {
  it("requests actor summaries only for the current page with typed reconciliation scope", () => {
    expect(tabSource).toContain('queryKey: ["resource-actor-summaries", "reconciliation", tenantId, reconIds]');
    expect(tabSource).toContain('getActorSummaries({ data: { resource_type: "reconciliation", resource_ids: reconIds } })');
    expect(tabSource).toContain("reconIds = useMemo(() => [...new Set(reconRows.map((row) => row.id))].slice(0, 100)");
    expect(tabSource).toContain("resourceActorById={reconActorsById}");
    expect(tabSource).toContain("dataSourceNameById={new Map(Object.entries(dsMap)");
  });

  it("renders trusted actor summaries in the updated line and rich View dialog", () => {
    expect(indexSource).toContain('mode="updated-line" summary={resourceActorById.get(row.id)}');
    expect(indexSource).toContain('mode="detail" summary={resourceActorById.get(viewedRow.id)}');
    expect(indexSource).toContain('<FviDetailDialogLayout');
    expect(indexSource).toContain("actions={renderSelectedActions(viewedRow)}");
    expect(indexSource).toContain('aria-label={`View ${row.name}`}');
    expect(indexSource).toContain("Version history");
    expect(indexSource).toContain("Lock state");
    expect(indexSource).not.toContain("Show details");
    expect(indexSource).toContain("Maker-checker approval state for definition changes is not provided");
    expect(tabSource).toContain("if (!canWrite || r.status !== \"draft\") return;");
    expect(tabSource).toContain("{canWrite && r.status === \"draft\" && <Button");
    expect(tabSource).toContain("focused?.status === \"draft\"");
  });
});
