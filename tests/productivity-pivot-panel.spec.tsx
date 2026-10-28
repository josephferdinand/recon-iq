// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PivotPanel } from "@/components/pivot-panel";

describe("Productivity pivot numeric values", () => {
  afterEach(cleanup);

  it("does not coerce missing or malformed values to zero and keeps real zero visible", () => {
    render(
      <PivotPanel
        rows={[
          { category: "Missing", amount: null },
          { category: "Invalid", amount: Number.NaN },
          { category: "Zero", amount: 0 },
        ]}
        fields={[
          { key: "category", label: "Category", type: "string" },
          { key: "amount", label: "Amount", type: "number" },
        ]}
        config={{ rowFields: ["category"], colField: null, valueField: "amount", agg: "sum" }}
        onConfigChange={vi.fn()}
        totalLabel="Available amount sum among loaded rows"
      />,
    );

    expect(screen.getByRole("row", { name: /Missing/ }).textContent).toContain("—");
    expect(screen.getByRole("row", { name: /Invalid/ }).textContent).toContain("—");
    expect(screen.getByRole("row", { name: /Zero/ }).textContent).toContain("0");
    expect(screen.getByRole("row", { name: /Available amount sum among loaded rows/ }).textContent).toContain("0");
    expect(screen.getByRole("button", { name: "Remove Category row grouping" })).toBeTruthy();
  });
});
