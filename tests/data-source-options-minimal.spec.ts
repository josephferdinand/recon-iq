import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("tenant-scoped data source picker options", () => {
  it("returns a bounded searchable minimal projection with selected-value readback", async () => {
    const source = await read("../src/lib/data-sources.functions.ts");
    const options = source.match(/export const listDataSourceOptions[\s\S]*?export const DATA_SOURCE_PAGE_FILTERS/u)?.[0] ?? "";
    expect(options).toContain(".middleware([requireSupabaseAuth()])");
    expect(options).toContain('.eq("tenant_id", data.tenant_id)');
    expect(source).toContain("const DATA_SOURCE_OPTIONS_LIMIT = 1000");
    expect(options).toContain('.select(projection, { count: "exact" })');
    expect(options).toContain('.order("name")');
    expect(options).toContain(".limit(DATA_SOURCE_OPTIONS_LIMIT)");
    expect(options).toContain('.ilike("name"');
    expect(options).toContain(".in(\"id\", data.selected_ids)");
    expect(options).toContain("truncated: count > DATA_SOURCE_OPTIONS_LIMIT");
    expect(options).not.toContain("sample_rows");
    expect(options).not.toContain("last_error");
    expect(options).not.toContain("connection_config");
  });

  it("keeps source choices searchable, complete through 1,000 rows, and selected while narrowing", async () => {
    const [connectors, dataPrep, recons] = await Promise.all([
      read("../src/components/connectors-tab.tsx"),
      read("../src/components/data-prep-tab.tsx"),
      read("../src/components/recons-tab.tsx"),
    ]);
    for (const [component, queryName] of [[connectors, "sources"], [dataPrep, "sources"], [recons, "ds"]] as const) {
      expect(component).toContain("listDataSourceOptions");
      expect(component).toContain(`${queryName}.data?.rows`);
      expect(component).toContain(`${queryName}.data?.selected`);
      expect(component).toContain(`${queryName}.data?.truncated`);
      expect(component).toContain("search by name to narrow the list");
      expect(component).toContain("max-h-72");
      expect(component).not.toContain("listDataSources}");
    }
    expect(connectors).toContain('aria-label="Search data sources"');
    expect(dataPrep).toContain('id="data-prep-source-search"');
    expect(recons).toContain('id="recon-source-search"');
    expect(recons).toContain("include_schema: true");
  });
});
