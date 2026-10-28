import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

type Spec = {
  paths: Record<string, Record<string, { "x-required-scope"?: string | string[] }>>;
};

const root = process.cwd();
const guide = readFileSync(join(root, "support-docs-site/docs/api/rest-api.md"), "utf8");
const spec = load(readFileSync(join(root, "docs/openapi/fvi-openapi.yaml"), "utf8")) as Spec;
const methods = new Set(["get", "post", "put", "patch", "delete"]);

function documentedOperations() {
  const operations = new Set<string>();
  for (const line of guide.split(/\r?\n/u)) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 4 || !cells[2].startsWith("`/api/")) continue;
    const path = cells[2].replace(/^`|`$/gu, "");
    for (const method of cells[1].split(/,\s*/u)) operations.add(`${method.toLowerCase()} ${path}`);
  }
  return operations;
}

describe("support REST API guide matches registered OpenAPI operations", () => {
  it("lists every operation and its exact required scope", () => {
    const documented = documentedOperations();
    const missing: string[] = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const method of Object.keys(item).filter((key) => methods.has(key))) {
        const operationKey = `${method} ${path}`;
        if (!documented.has(operationKey)) missing.push(operationKey);
        if (path.startsWith("/api/v1/")) {
          const requiredScope = item[method]["x-required-scope"];
          const row = guide.split(/\r?\n/u).find((line) =>
            line.includes(`| ${method.toUpperCase()} | \`${path}\` |`),
          );
          const expectedScopes = Array.isArray(requiredScope) ? requiredScope : [requiredScope];
          const documentedScope = expectedScopes.every((scope) => row?.includes(`\`${scope}\``))
            || (expectedScopes.length === 1 && row?.includes(`| ${expectedScopes[0]} |`));
          if (!documentedScope) missing.push(`${operationKey} scope=${expectedScopes.join(",")}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("keeps endpoint examples tied to registered route paths and scopes", () => {
    expect(guide).toContain("/api/v1/$FVI_TENANT_SLUG/recons/?limit=50");
    expect(guide).toContain("/api/v1/$FVI_TENANT_SLUG/recons/$FVI_RECON_ID/runs");
    expect(guide).toContain("recons.read");
    expect(guide).toContain("recons.run");
    expect(guide).toContain("tenant_scope_mismatch");
    expect(guide).toContain("missing_scope");
  });

  it("does not repeat fabricated hosts or claim every UI feature is REST", () => {
    for (const unsupportedClaim of [
      "https://api.reconiq.example",
      "https://api-staging.reconiq.example",
      "Anything you can do in the UI, you can do via the API",
      "OpenAPI 3.0 spec",
      "12 endpoint groups",
    ]) {
      expect(guide).not.toContain(unsupportedClaim);
    }
    expect(guide).toContain("UAT has no verified application origin");
    expect(guide).toContain("does not prove that an environment has deployed the route");
  });
});
