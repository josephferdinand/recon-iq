import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function navKeys(source: string) {
  return [...source.matchAll(/\{ key: "([^"]+)",\s+label:/gu)].map((match) => match[1]);
}

describe("administration disposition coverage", () => {
  it("classifies every current Platform and Tenant Administration tab exactly once", async () => {
    const [platform, tenant, disposition] = await Promise.all([
      readFile(fileURLToPath(new URL("../src/routes/_authenticated/platform.tsx", import.meta.url)), "utf8"),
      readFile(fileURLToPath(new URL("../src/routes/_authenticated/$slug/tenant.admin.tsx", import.meta.url)), "utf8"),
      readFile(fileURLToPath(new URL("../docs/49_platform_tenant_admin_disposition.md", import.meta.url)), "utf8"),
    ]);
    const platformKeys = navKeys(platform);
    const tenantKeys = navKeys(tenant);
    expect(platformKeys).toHaveLength(44);
    expect(tenantKeys).toHaveLength(17);
    for (const key of [...platformKeys, ...tenantKeys]) {
      expect(disposition.split(`| \`${key}\` |`)).toHaveLength(2);
    }
    expect(disposition).toContain("No administration feature was removed");
  });
});
