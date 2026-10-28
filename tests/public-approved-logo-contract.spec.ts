import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const publicSurfaces = [
  "src/routes/index.tsx",
  "src/routes/status.tsx",
  "src/components/solution-page.tsx",
];

const additionalIdentityRoutes = [
  "src/routes/about.tsx",
  "src/routes/developers.tsx",
  "src/routes/solutions.index.tsx",
  "src/routes/support.tsx",
  "src/routes/pricing.tsx",
];

describe("approved logo on remaining public surfaces", () => {
  it.each(publicSurfaces)("uses the approved, white-backed mark in %s", (path) => {
    const source = readFileSync(path, "utf8");

    expect(source).toContain('import { FviApprovedLogo } from "@/components/fvi-approved-logo";');
    expect(source).toContain("<FviApprovedLogo");
    expect(source).not.toContain('variant="symbol"');
    expect(source).not.toContain("FVMonogram");
  });

  it.each(additionalIdentityRoutes)(
    "uses the exact approved lockup instead of the legacy monogram in %s",
    (path) => {
      const source = readFileSync(path, "utf8");

      expect(source).toContain('import { FviApprovedLogo } from "@/components/fvi-approved-logo";');
      expect(source).toContain("<FviApprovedLogo");
      expect(source).not.toContain("variant=\"symbol\"");
      expect(source).not.toContain("FVMonogram");
    },
  );

  it("renders the ReconIQ monogram seal, not the retired raster master", () => {
    const component = readFileSync("src/components/fvi-approved-logo.tsx", "utf8");

    expect(component).toContain("FVMonogram");
    expect(component).not.toContain("reconiq-approved-logo");
    expect(component).not.toContain(".jpg");
  });

  it("uses the full approved logo on both sign-in surfaces, not a second drawn brand symbol", () => {
    const source = readFileSync("src/routes/auth.tsx", "utf8");
    expect(source.match(/<FviApprovedLogo /gu)).toHaveLength(2);
    expect(source).not.toContain("ApertureMark");
  });
});
