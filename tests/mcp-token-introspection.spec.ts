import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("MCP bearer introspection contract", () => {
  it("uses the existing hashed token authority and returns no secret value", async () => {
    const source = await readFile("src/lib/public-workflow-api.server.ts", "utf8");
    const route = await readFile("src/routes/api/public/tokens/introspect.ts", "utf8");
    expect(route).toContain("introspectWorkflowToken(request)");
    expect(source).toContain("authenticateWorkflowToken(request)");
    expect(source).toContain("tenant_slug: tenant.slug");
    expect(source).toContain("subject: principal.actorUserId");
    expect(source).toContain("scopes: principal.scopes");
    expect(source).not.toMatch(/return workflowApiJson\(200,[\s\S]{0,500}(token_hash|plaintext|service_role)/u);
  });
});
