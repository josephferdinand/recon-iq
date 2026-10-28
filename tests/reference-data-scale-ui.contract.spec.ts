import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("reference data scale screen contract", () => {
  it("pages and counts tenant-scoped saved tables with stable sorting and filters", async () => {
    const server = await readFile("src/lib/reference-data.functions.ts", "utf8");
    expect(server).toContain('.eq("tenant_id", data.tenant_id)');
    expect(server).toContain('{ count: "exact" }');
    expect(server).toContain('.range(data.page * data.page_size');
    expect(server).toContain('.order("id", { ascending: true })');
    expect(server).toContain('type: z.enum(["all", "enrichment", "validation"])');
    expect(server).toContain('status: z.enum(["all", "active", "inactive"])');
    expect(server).toContain('query.not("value_columns", "eq", "{}")');
  });

  it("keeps examples sample-only and preserves governed version actions", async () => {
    const ui = await readFile("src/components/reference-data-tab.tsx", "utf8");
    expect(ui).toContain("Template example — not tenant data");
    expect(ui).toContain('displayName: "Foreign exchange spot rates"');
    expect(ui).toContain('displayName: "Account aliases"');
    expect(ui).toContain('displayName: "Settlement holidays"');
    expect(ui).toContain("They are not stored in your tenant");
    expect(ui).toContain('stageVersion({');
    expect(ui).toContain("Submit for approval");
    expect(ui).toContain("Create rollback draft");
    expect(ui).toContain("Approve");
    expect(ui).toContain("Reject");
  });

  it("exposes searchable type and status filters with exact-count paging", async () => {
    const ui = await readFile("src/components/reference-data-tab.tsx", "utf8");
    expect(ui).toContain("Search reference tables");
    expect(ui).toContain("Filter by table type");
    expect(ui).toContain("Filter by table status");
    expect(ui).toContain("Page {page + 1} of {pageCount}");
    expect(ui).toContain("Table details & saved rows");
    expect(ui).toContain("Reference tables are unavailable");
  });
});
