import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusPublicView } from "@/components/status-public-view";
import { statusPrototypeSnapshot } from "@/lib/status-prototype-data";
describe("public status page evidence copy", () => {
  it("labels prototype/unknown scope and keeps unregistered environments disabled", () => {
    const markup = renderToStaticMarkup(<StatusPublicView snapshot={statusPrototypeSnapshot()} preview />);
    expect(markup).toContain("Working source prototype"); expect(markup).toContain("Unknown service health");
    expect(markup).toContain("Region unverified"); expect(markup).toContain("UAT — unregistered");
    expect(markup).not.toContain("All systems operational"); expect(markup).not.toContain("100.000%");
    expect(markup.toLowerCase().includes("legacy seeded history")).toBe(true);
  });
});
