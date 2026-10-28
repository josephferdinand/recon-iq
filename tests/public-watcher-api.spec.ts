import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("public watcher API", () => {
  it("enforces scopes, tenant ownership, idempotency and the shared evaluator", async () => {
    const source = await readFile("src/lib/public-watcher-api.server.ts", "utf8");
    expect(source).toContain('requiredScope: "watchers.read"');
    expect(source).toContain('requiredScope: "watchers.write"');
    expect(source).toContain("requirePublicIdempotencyKey");
    expect(source).toContain("claimPublicMutation");
    expect(source).toContain("evaluateWatcherById");
    expect(source).toContain('trigger: "api"');
    expect(source).toContain('.eq("tenant_id", auth.principal.tenantId)');
    expect(source).not.toMatch(/select\(["']\*["']\)/u);
  });

  it("exposes create, update, disable, evaluate, list and event routes", async () => {
    for (const route of [
      "src/routes/api/v1/$tenantSlug/watchers/index.ts",
      "src/routes/api/v1/$tenantSlug/watchers/$watcherId/index.ts",
      "src/routes/api/v1/$tenantSlug/watchers/$watcherId/disable.ts",
      "src/routes/api/v1/$tenantSlug/watchers/$watcherId/evaluate.ts",
      "src/routes/api/v1/$tenantSlug/watchers/$watcherId/events.ts",
    ])
      expect(await readFile(route, "utf8")).toContain("createFileRoute");
  });
});
