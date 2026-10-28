import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("FVI MCP server contract", () => {
  it("exposes the approved dashboard, read and confirmed-write tool surface", async () => {
    const source = await readFile("src/server.ts", "utf8");
    for (const name of [
      "view_operations_dashboard", "list_reconciliations", "get_reconciliation",
      "list_breaks", "get_break", "get_workflow_job", "list_connector_schedules",
      "get_connector_capabilities", "list_reports", "run_data_prep",
      "run_reconciliation", "run_connector", "action_break", "generate_report",
    ]) expect(source).toContain(`name: "${name}"`);
    expect(source).toContain("z.literal(true)");
    expect(source).toContain("idempotency_key");
    expect(source).toContain('component: "operations-dashboard"');
  });

  it("keeps database, credential lifecycle and arbitrary network access outside the gateway", async () => {
    const source = await readFile("src/server.ts", "utf8");
    expect(source).not.toMatch(/supabase|sql|rotate|revoke|secret[_-]?retriev/iu);
    expect(source).not.toMatch(/inputSchema:[\s\S]{0,180}\b(url|path|connection_string|credential)\b/iu);
    expect(source).toContain("callFviApi");
    expect(source).toContain("requireTenant");
  });
});
