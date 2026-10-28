import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

type OpenApi = {
  paths: Record<string, Record<string, unknown>>;
  servers?: Array<{ url: string }>;
};

const root = process.cwd();
const spec = load(
  readFileSync(join(root, "docs/openapi/fvi-openapi.yaml"), "utf8"),
) as OpenApi;
const evidence = readFileSync(
  join(root, "docs/evidence/FVI_API_COVERAGE_AND_DOCUMENTATION_2026-10-01.md"),
  "utf8",
);
const pagePermissions = readFileSync(join(root, "src/lib/page-permissions.ts"), "utf8");
const platformRoute = readFileSync(join(root, "src/routes/_authenticated/platform.tsx"), "utf8");
const operationMethods = new Set(["get", "post", "put", "patch", "delete"]);
const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
  Object.keys(item)
    .filter((method) => operationMethods.has(method))
    .map((method) => ({ path, method })),
);

function navigationPageKeys(name: "WORKSPACE_PAGES" | "TENANT_PAGES"): string[] {
  const array = pagePermissions.match(
    new RegExp(`export const ${name}: PageDef\\[\\] = \\[([\\s\\S]*?)\\n\\];`, "u"),
  )?.[1];
  if (!array) throw new Error(`Could not read ${name} from page-permissions.ts`);
  return [...array.matchAll(/\bkey:\s*"([^"]+)"/gu)].map((match) => match[1]);
}

function platformPageKeys(): string[] {
  const array = platformRoute.match(/const PAGES: RailItem\[\] = \[([\s\S]*?)\n\];/u)?.[1];
  if (!array) throw new Error("Could not read platform navigation from platform.tsx");
  return [...array.matchAll(/\bkey:\s*"([^"]+)"/gu)].map((match) => match[1]);
}

describe("API coverage evidence stays bounded to source and observed environment facts", () => {
  it("keeps the report's checked-in operation totals aligned with OpenAPI", () => {
    const tenantOperations = operations.filter(({ path }) => path.startsWith("/api/v1/")).length;
    expect(evidence).toContain(`**${operations.length} operations on ${Object.keys(spec.paths).length} paths**`);
    expect(evidence).toContain(`including **${tenantOperations} tenant-v1 operations**`);
  });

  it("does not add an unverified environment server to the source contract", () => {
    expect(spec.servers).toBeUndefined();
    expect(evidence).toContain("UAT as **unverified**");
    expect(evidence).toContain("Do not infer an app URL from a Supabase project URL");
    expect(evidence).toContain("Do not use those server entries");
  });

  it("accounts for every workspace and tenant navigation feature in the coverage crosswalk", () => {
    const missing = ["WORKSPACE_PAGES", "TENANT_PAGES"].flatMap((name) =>
      navigationPageKeys(name as "WORKSPACE_PAGES" | "TENANT_PAGES")
        .filter((key) => !evidence.includes(`\`${key}\``))
        .map((key) => `${name}.${key}`),
    );
    missing.push(
      ...platformPageKeys()
        .filter((key) => !evidence.includes(`\`${key}\``))
        .map((key) => `PLATFORM_PAGES.${key}`),
    );
    expect(missing).toEqual([]);
  });

  it("distinguishes hosted OpenAPI reachability from route deployment and parity", () => {
    expect(evidence).toContain("returned HTTP 200");
    expect(evidence).toContain("does **not** match this checkout");
    expect(evidence).toContain("No customer route, token issuance, user session, database mutation, or provider was exercised");
    expect(evidence).toContain("full API coverage is **not accepted**");
  });

  it("documents the actual audit actor constraint without inventing null-actor support", () => {
    expect(evidence).toContain("rejects a non-system/null actor");
    expect(evidence).toContain("not independently reproduced by this docs task");
    expect(evidence).toContain("Do not infer zero-actor support from unit fixtures");
  });

  it("keeps REST gaps specific and rejects a universal RPC gateway", () => {
    expect(evidence).toContain("There is no global RPC proxy/gateway. Do not build one.");
    for (const gap of [
      "Reconciliation-definition read/create/update/archive",
      "Data-ingestion submission/status",
      "Exception-case operations beyond the existing break-action subset",
      "Connector schedule/configuration lifecycle",
      "Tenant/API-token/member/role administration",
      "Audit/evidence export and webhook subscription/delivery controls",
    ]) {
      expect(evidence).toContain(gap);
    }
  });
});
