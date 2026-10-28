import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("AIDP public document insert contract", () => {
  it("keeps API provenance inside extraction JSON instead of a nonexistent source column", async () => {
    const source = await readFile(
      fileURLToPath(new URL("../src/routes/api/public/aidp/extract.ts", import.meta.url)),
      "utf8",
    );
    const insertBlock = source.match(/const docInsert:[\s\S]*?if \(idemKey\)/u)?.[0] ?? "";
    expect(insertBlock).toContain('extraction: { storage_path: storagePath, source: "public_api" }');
    expect(insertBlock).not.toMatch(/^\s*source:\s*"public_api"/mu);
  });
});
