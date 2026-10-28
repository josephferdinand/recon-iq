import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

function luminance(hex: string) {
  const channels = hex
    .match(/[0-9a-f]{2}/giu)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(left: string, right: string) {
  const leftLuminance = luminance(left);
  const rightLuminance = luminance(right);
  return (
    (Math.max(leftLuminance, rightLuminance) + 0.05) /
    (Math.min(leftLuminance, rightLuminance) + 0.05)
  );
}

describe("developer API reference accessibility", () => {
  it("uses accessible Redoc link and error colors on light and dark surfaces", async () => {
    const source = await readFile(
      new URL("../src/routes/developers.api-reference.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('primary: { main: "#7A4A0F" }');
    expect(source).toContain('success: { main: "#166534" }');
    expect(source).toContain('error: { main: "#8B1E1E" }');
    expect(source).toContain("#fvi-redoc code { color: #8B1E1E !important; }");
    expect(source).toContain(
      "#fvi-redoc .redoc-json .token.punctuation { color: #F3DAC2 !important; }",
    );
    expect(source).toContain('.tab-error[aria-selected="true"]');
    expect(source).toContain('.tab-error[aria-selected="false"]');
    expect(source).toContain("data-redoc-status={status}");
    expect(contrast("#7A4A0F", "#FCF7EF")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#166534", "#ECEFE1")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#8B1E1E", "#F9E8E0")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#FF8A80", "#11171A")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#F3DAC2", "#11171A")).toBeGreaterThanOrEqual(4.5);
  });
});
