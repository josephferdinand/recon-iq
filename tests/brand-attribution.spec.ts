import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("public brand attribution", () => {
  it("credits the ReconIQ Team on login and website", async () => {
    const sources = await Promise.all([
      readFile("src/routes/auth.tsx", "utf8"),
      readFile("src/routes/index.tsx", "utf8"),
    ]);
    for (const source of sources) {
      expect(source).toContain("Designed and Architected by");
      expect(source).toContain("ReconIQ Team");
      expect(source).not.toMatch(/Designed and Architected by(?:<\/span>\s*<[^>]+>)?\s*JF\b/u);
    }
  });
});
