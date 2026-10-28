import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Pages deploy configuration", () => {
  it("parses the repository JSONC source before writing strict generated JSON", async () => {
    const source = await readFile("scripts/prepare-pages-deploy-config.mjs", "utf8");
    expect(source).toContain("trailing commas accepted by Wrangler");
    expect(source).toContain('.replace(/,\\s*([}\\]])/gu, "$1")');
    expect(source).toContain('config.pages_build_output_dir = ".."');
  });
});
