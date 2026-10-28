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

describe("seeded palette accessibility", () => {
  it("repairs only the original Arctic primary and meets normal-text contrast", async () => {
    const migration = await readFile(
      new URL(
        "../supabase/migrations/20260905144500_fix_arctic_palette_contrast.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).toContain("lower(tokens ->> 'primary') = '#0ea5e9'");
    expect(migration).toContain("'#0369A1'");
    expect(contrast("#0369A1", "#F8FAFC")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#0369A1", "#FEFAF3")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#0369A1", "#FFFCF8")).toBeGreaterThanOrEqual(4.5);
  });
});
