import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("public operations API contracts", () => {
  it("exposes bounded tenant-scoped reconciliation and connector reads", async () => {
    const source = await readFile("src/lib/public-operations-api.server.ts", "utf8");
    expect(source).toContain('requiredScope: "recons.read"');
    expect(source).toContain('requiredScope: "connectors.read"');
    expect(source).toContain('.eq("tenant_id", auth.principal.tenantId)');
    expect(source).toContain("Math.min(200");
    expect(source).not.toContain('select("*")');
    expect(source).not.toMatch(/\bconfig\b.*select/u);
    expect(source).toContain('.select("id,run_uid,definition_id,status');
    expect(source).toContain('.select("id,run_uid,status');
  });

  it("never returns connector configuration or reconciliation rule payloads", async () => {
    const source = await readFile("src/lib/public-operations-api.server.ts", "utf8");
    expect(source).not.toContain("last_error");
    expect(source).not.toMatch(/select\([^)]*\brules\b/u);
    expect(source).not.toMatch(/select\([^)]*\bsides\b/u);
  });
});
