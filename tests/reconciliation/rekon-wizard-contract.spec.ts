import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Rekon wizard source catalogue contract", () => {
  it("selects the live workspace data-source type column", () => {
    const source = readFileSync("src/lib/rekon-wizard.functions.ts", "utf8");
    expect(source).toContain('.select("id, name, source_type, updated_at")');
    expect(source).not.toContain('.select("id, name, kind, updated_at")');
  });
});
