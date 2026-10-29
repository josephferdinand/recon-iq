import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Public surfaces that carry the approved mark through the shared
// MarketingNav (which renders RQApprovedLogo in its header).
const navCarriedSurfaces = [
  "src/routes/index.tsx",
  "src/components/solution-page.tsx",
  "src/routes/about.tsx",
  "src/routes/solutions.index.tsx",
  "src/routes/pricing.tsx",
];

// Public surfaces that render the approved mark directly.
const directMarkSurfaces = ["src/routes/developers.tsx", "src/routes/support.tsx"];

describe("approved logo on remaining public surfaces", () => {
  it.each(navCarriedSurfaces)(
    "shows the approved mark via the shared marketing nav in %s",
    (path) => {
      const source = readFileSync(path, "utf8");

      expect(source).toContain("<MarketingNav");
      expect(source).not.toContain('variant="symbol"');
      expect(source).not.toContain("RQSeal");
    },
  );

  it.each(directMarkSurfaces)(
    "uses the approved, white-backed mark directly in %s",
    (path) => {
      const source = readFileSync(path, "utf8");

      expect(source).toContain('import { RQApprovedLogo } from "@/components/rq-approved-logo";');
      expect(source).toContain("<RQApprovedLogo");
      expect(source).not.toContain('variant="symbol"');
      expect(source).not.toContain("RQSeal");
    },
  );

  it("renders the approved mark and wordmark in the shared marketing nav", () => {
    const nav = readFileSync("src/components/marketing-nav.tsx", "utf8");

    expect(nav).toContain('import { RQApprovedLogo } from "@/components/rq-approved-logo";');
    expect(nav).toContain("<RQApprovedLogo");
    expect(nav).toContain("ReconIQ");
  });

  it("shows the approved seal in the public status header", () => {
    const route = readFileSync("src/routes/status.tsx", "utf8");
    const view = readFileSync("src/components/status-public-view.tsx", "utf8");

    expect(route).toContain("<StatusPublicView");
    expect(view).toContain('src="/rq-seal.svg"');
    expect(view).toContain('alt="ReconIQ logo"');
  });

  it("renders the ReconIQ monogram seal, not the retired raster master", () => {
    const component = readFileSync("src/components/rq-approved-logo.tsx", "utf8");

    expect(component).toContain("RQSeal");
    expect(component).not.toContain("reconiq-approved-logo");
    expect(component).not.toContain(".jpg");
  });

  it("uses the full approved logo on both sign-in surfaces, not a second drawn brand symbol", () => {
    const source = readFileSync("src/routes/auth.tsx", "utf8");
    expect(source.match(/<RQApprovedLogo /gu)).toHaveLength(2);
    expect(source).not.toContain("ApertureMark");
  });
});
