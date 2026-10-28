import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("My Templates operational screen", () => {
  it("keeps the owner-facing table and bounded server paging", async () => {
    const source = await readFile("src/components/template-marketplace.tsx", "utf8");
    expect(source).toContain("listTenantTemplatesPage");
    expect(source).toContain('aria-label="My Templates"');
    for (const column of ["Name", "Asset class", "Sides", "Version", "Status", "Updated", "Owner"]) {
      expect(source).toContain(`<th scope="col" className=`);
      expect(source).toContain(`>${column}</th>`);
    }
    expect(source).toContain('aria-label="Next My Templates page"');
    expect(source).toContain('aria-label="Previous My Templates page"');
    expect(source).toContain("Loading marketplace installs…");
    expect(source).toContain("Marketplace installs could not be loaded.");
    expect(source).not.toContain("sm:grid-cols-[minmax(0,1fr)_minmax(10rem,0.7fr)_10rem]");
  });

  it("never renders raw exception or database messages in toast errors", async () => {
    const source = await readFile("src/components/template-marketplace.tsx", "utf8");
    expect(source).toContain("userFacingErrorKind(error)");
    expect(source).not.toMatch(/toast\.error\([^)]*\b(?:e|error)\.message\b/u);
  });
});
