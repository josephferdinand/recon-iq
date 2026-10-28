import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDataSourceColor } from "@/components/workspace-dashboard";

const component = readFileSync("src/components/workspace-dashboard.tsx", "utf8");

describe("workspace dashboard data-source palette", () => {
  it("assigns stable, distinct colors to every supported source type", () => {
    const sourceTypes = ["csv", "xlsx", "json", "api", "database", "manual"];
    const colors = sourceTypes.map(getDataSourceColor);

    expect(new Set(colors).size).toBe(sourceTypes.length);
    expect(colors).not.toContain("hsl(340 75% 60%)");
    expect(getDataSourceColor("CSV")).toBe(getDataSourceColor("csv"));
  });

  it("uses the same named color for each slice and its labeled legend item", () => {
    expect(component).toContain("getDataSourceColor(s.name)} stroke=\"var(--background)\"");
    expect(component).toContain("style={{ background: getDataSourceColor(s.name) }}");
    expect(component).toContain("role=\"list\" aria-label=\"Data source types and counts\"");
    expect(component).toContain("<ChartTooltipContent nameKey=\"name\" />");
    expect(component).toContain("--data-source-csv:#1e3a5f");
    expect(component).toContain("dark:[--data-source-csv:#6be5ff]");
  });

  it("provides a readable fallback for an unrecognized future source type", () => {
    expect(getDataSourceColor("sftp")).toBe("var(--data-source-other)");
  });
});
