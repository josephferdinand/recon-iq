import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("File Uploads table-first source list", () => {
  it("keeps the paginated source table compact and exposes schema in the selected-source inspector", async () => {
    const source = await readFile("src/components/data-sources-tab.tsx", "utf8");
    expect(source).toContain("const PAGE_SIZE = 25");
    expect(source).toContain('<Table aria-label="Data sources"');
    expect(source).toContain("const columnCount = source.inferred_schema?.length");
    expect(source).toContain('aria-label="Selected data source details"');
    expect(source).toContain('aria-labelledby="data-source-schema-heading"');
    expect(source).toContain("aria-expanded={schemaOpen}");
    expect(source).toContain('onClick={() => setSchemaOpen((current) => !current)}');
    expect(source).toContain("{schemaOpen ? (");
    expect(source).toContain("rows.map((source)");
    expect(source).toContain('aria-label="Next page"');
  });
});
