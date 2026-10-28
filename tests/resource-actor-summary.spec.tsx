import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResourceActorSummary } from "@/components/resource-actor-summary";
import type { ResourceActorSummary as Data } from "@/lib/resource-actor-summaries.functions";

const summary: Data = {
  resource_type: "data_source",
  resource_id: "11111111-1111-4111-8111-111111111111",
  created_by_label: "Alex Smith",
  created_by_status: "known",
  updated_by_label: "Jordan Lee",
  updated_by_status: "known",
};

describe("resource actor display", () => {
  it("shows only safe names, never raw actor IDs", () => {
    const html = renderToStaticMarkup(createElement(ResourceActorSummary, { summary, available: true, mode: "detail" }));
    expect(html).toContain("Alex Smith");
    expect(html).toContain("Jordan Lee");
    expect(html).not.toContain(summary.resource_id);
  });

  it("distinguishes missing RPC from known historical unknown", () => {
    const unavailable = renderToStaticMarkup(createElement(ResourceActorSummary, { available: false, mode: "updated-line" }));
    const historical = renderToStaticMarkup(createElement(ResourceActorSummary, { summary: { ...summary, updated_by_label: "Unknown", updated_by_status: "unknown" }, available: true, mode: "updated-line" }));
    expect(unavailable).toContain("Editor unavailable");
    expect(unavailable).not.toContain("by Editor unavailable");
    expect(historical).toContain("Editor unknown");
  });
});
