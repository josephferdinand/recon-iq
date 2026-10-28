import { createElement } from "react";
import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResourceIdentitySummary } from "@/components/resource-identity-summary";
import type { ResourceAccessSummary } from "@/lib/resource-access-summaries.functions";

const mapped: ResourceAccessSummary = {
  resource_type: "data_source",
  resource_id: "11111111-1111-4111-8111-111111111111",
  public_id: "SRC-00184",
  access_state: "mapped",
  business_unit_names: ["Treasury", "Trading", "Finance"],
  business_unit_count: 3,
  user_group_names: ["Ops", "Risk"],
  user_group_count: 2,
};

describe("resource identity summary", () => {
  it("shows compact counts and visible authorized names without exposing raw IDs", () => {
    const html = renderToStaticMarkup(createElement(ResourceIdentitySummary, { summary: mapped, available: true }));
    expect(html).toContain("SRC-00184");
    expect(html).toContain("3 business units");
    expect(html).toContain("Treasury");
    expect(html).toContain("+2");
    expect(html).not.toContain(mapped.resource_id);
    expect(html).not.toContain("Trading");
  });

  it("shows Unassigned only for a confirmed unmapped row", () => {
    const html = renderToStaticMarkup(createElement(ResourceIdentitySummary, {
      summary: { ...mapped, access_state: "unmapped", business_unit_names: [], business_unit_count: 0, user_group_names: [], user_group_count: 0 },
      available: true,
    }));
    expect(html).toContain("Unassigned");
    expect(html).not.toContain("Access mapping unavailable");
  });

  it("keeps absent RPC data explicitly unavailable instead of claiming zero mappings", () => {
    const html = renderToStaticMarkup(createElement(ResourceIdentitySummary, { summary: undefined, available: false }));
    expect(html).toContain("Access mapping unavailable");
    expect(html).not.toContain("Unassigned");
    expect(html).not.toContain("None");
    expect(html).toContain("ID pending setup");
  });

  it("limits the authenticated batch to requested IDs and filters unexpected RPC rows", async () => {
    const wrapper = await readFile("src/lib/resource-access-summaries.functions.ts", "utf8");
    expect(wrapper).toContain(".max(100)");
    expect(wrapper).toContain("_resource_ids: requested");
    expect(wrapper).toContain("requestedSet.has(row.resource_id)");
    expect(wrapper).toContain("requireSupabaseAuth()");
    expect(wrapper).not.toMatch(/service.?role|admin.?client/i);
  });

  it("allows reconciliation identity summaries through the shared RPC wrapper", async () => {
    const wrapper = await readFile("src/lib/resource-access-summaries.functions.ts", "utf8");
    expect(wrapper).toContain('"reconciliation"');
    expect(wrapper).toContain('z.enum(RESOURCE_ACCESS_TYPES)');
  });

  it("wires AIDP documents and templates to visible-row summaries and detail views", async () => {
    const aidp = await readFile("src/components/aidp-tab.tsx", "utf8");
    expect(aidp).toContain('resource_type: "aidp_document"');
    expect(aidp).toContain('resource_type: "aidp_template"');
    expect(aidp).toContain("documents.map((row: any) => row.id)");
    expect(aidp).toContain("templates.map((row: any) => row.id)");
    expect(aidp).toContain('mode="detail"');
    expect(aidp).toContain("View detail");
    expect(aidp).toContain('Public ID</th><th scope="col" className="py-2">Document name');
    expect(aidp).toContain('<th>Public ID</th><th className="py-2">Name');
    expect(aidp.indexOf('section="identity" summary={docAccessById.get(d.id)}')).toBeLessThan(aidp.indexOf('title={d.original_filename}'));
    expect(aidp.indexOf('section="identity" summary={templateAccessById.get(t.id)}')).toBeLessThan(aidp.indexOf('className="py-3 font-medium">{t.name}'));
  });

  it("wires reference tables to current-page summaries and a detail view", async () => {
    const referenceData = await readFile("src/components/reference-data-tab.tsx", "utf8");
    expect(referenceData).toContain('resource_type: "reference_table"');
    expect(referenceData).toContain("tables.map((row: any) => row.id)");
    expect(referenceData).toContain('mode="detail"');
    expect(referenceData).toContain("View detail");
    expect(referenceData).toContain('<th className="px-6 py-3">Public ID</th>\n                    <th className="px-6 py-3">Name & description</th>');
    expect(referenceData.indexOf('section="identity" summary={accessById.get(t.id)}')).toBeLessThan(referenceData.indexOf("{t.name}"));
  });
});
