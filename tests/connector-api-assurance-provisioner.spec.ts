import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("connector API assurance provisioner", () => {
  it("creates an isolated token without rescoping existing credentials", async () => {
    const source = await readFile(
      new URL("../scripts/provision-fvi-connector-api-assurance.mjs", import.meta.url),
      "utf8",
    );
    expect(source).toContain('const scopes = ["connectors.run"]');
    expect(source).toContain("refusing rescope");
    expect(source).toContain("refusing replacement");
    expect(source).toContain("FVI-Assurance-Lab-Connector-API-DEV.md");
    expect(source).toContain("https://jsonplaceholder.typicode.com/users");
  });
});
