import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import {
  API_TOKEN_SCOPE_GROUPS,
  API_TOKEN_SCOPE_IDS,
  newApiTokenScopesSchema,
} from "@/lib/api-token-scopes";

const root = process.cwd();

describe("API token scope provisioning contract", () => {
  it("offers exactly the route scopes documented in OpenAPI", () => {
    const spec = load(readFileSync(`${root}/docs/openapi/fvi-openapi.yaml`, "utf8")) as { paths: unknown };
    const documented = new Set<string>();
    for (const path of Object.values(spec.paths as Record<string, Record<string, unknown>>)) {
      for (const operation of Object.values(path)) {
        if (!operation || typeof operation !== "object") continue;
        const scope = (operation as { "x-required-scope"?: string | string[] })["x-required-scope"];
        if (Array.isArray(scope)) scope.forEach((value) => documented.add(value));
        else if (scope) documented.add(scope);
      }
    }
    expect(new Set(API_TOKEN_SCOPE_IDS)).toEqual(documented);
    expect(API_TOKEN_SCOPE_GROUPS.flatMap((group) => group.scopes).length).toBe(API_TOKEN_SCOPE_IDS.length);
  });

  it("accepts only unique, explicitly supported scopes for newly issued tokens", () => {
    expect(newApiTokenScopesSchema.safeParse(["recons.read", "connectors.run"]).success).toBe(true);
    for (const rejected of [
      [],
      ["recon.read"],
      ["recon.write"],
      ["ingest.write"],
      ["exceptions.read"],
      ["exceptions.update"],
      ["agent.invoke"],
      ["*"],
      ["admin"],
    ]) {
      expect(newApiTokenScopesSchema.safeParse(rejected).success, rejected.join(",")).toBe(false);
    }
    expect(newApiTokenScopesSchema.safeParse(["recons.read", "recons.read"]).success).toBe(false);
  });

  it("keeps legacy tokens readable without rewriting or aliasing stored scopes", () => {
    const source = readFileSync(`${root}/src/lib/public-workflow-api.server.ts`, "utf8");
    expect(source).toContain("const scopes = Array.isArray(row.scopes) ? row.scopes : []");
    expect(source).toContain("scopes.includes(\"*\") || scopes.includes(required)");
    const issuer = readFileSync(`${root}/src/lib/gtm.functions.ts`, "utf8");
    expect(issuer).toContain("scopes: newApiTokenScopesSchema");
    expect(issuer).not.toMatch(/recon\.read.*=>|recon\.read.*recons\.read/su);
  });
});
