import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { formatPercentage, formatStatusLabel } from "@/components/exception-dashboard";

describe("exception dashboard formatting", () => {
  it("reserves exact zero and one hundred percent for real boundaries", () => {
    expect(formatPercentage(0, 396)).toBe("0%");
    expect(formatPercentage(396, 396)).toBe("100%");
    expect(formatPercentage(1, 396)).toBe("0.3%");
    expect(formatPercentage(395, 396)).toBe("99.7%");
    expect(formatPercentage(19_999, 20_000)).toBe(">99.9%");
    expect(formatPercentage(20_001, 20_000)).toBe(">100%");
    expect(formatPercentage(397, 396)).toBe("100.3%");
    expect(formatPercentage(1, 20_000)).toBe("<0.1%");
  });

  it("uses concise status axes and full readable status descriptions", () => {
    expect(formatStatusLabel("pending_counterparty", true)).toBe("Pending CP");
    expect(formatStatusLabel("pending_counterparty")).toBe("Pending counterparty");
    expect(formatStatusLabel("written_off", true)).toBe("Written off");
    expect(formatStatusLabel("custom_review_state")).toBe("Custom Review State");
  });

  it("renders operational charts without transitional animation", async () => {
    const source = await readFile("src/components/exception-dashboard.tsx", "utf8");
    expect(source.match(/isAnimationActive=\{false\}/g)).toHaveLength(3);
  });
});
