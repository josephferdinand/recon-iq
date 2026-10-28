import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CONNECTOR_AGENT_TYPES, validateAgentRows, validateConnectorAgentId } from "@/lib/connector-agent-api.server";
import { workflowScopeForJobKind } from "@/lib/public-workflow-api.server";

describe("connector agent control-plane contract", () => {
  it("supports exactly the four on-premises connector types", () => {
    expect(CONNECTOR_AGENT_TYPES).toEqual(["sftp", "ftp", "local", "network_drive"]);
    expect(workflowScopeForJobKind("connector_agent_run")).toBe("connectors.run");
  });

  it("validates agent identity and bounded normalized rows", () => {
    expect(validateConnectorAgentId("site-a-agent-01")).toBe("site-a-agent-01");
    expect(validateConnectorAgentId("../escape")).toBeNull();
    expect(validateAgentRows({ rows: [{ id: "A1", amount: 10 }], columns: ["id", "amount"], filename: "agent.json" }))
      .toMatchObject({ filename: "agent.json", sizeBytes: 25 });
    expect(validateAgentRows({ rows: [{}], columns: ["id", "id"], filename: "agent.json" })).toBeNull();
    expect(validateAgentRows({ rows: [{ id: "A1" }], columns: ["different"], filename: "agent.json" })).toBeNull();
    expect(validateAgentRows({ rows: [{}], columns: [], filename: "../secret.json" })).toBeNull();
  });

  it("keeps agent jobs away from the Cloudflare worker claimant and exposes only allow-listed config", async () => {
    const migration = await readFile("supabase/migrations/20260906014500_add_connector_agent_queue.sql", "utf8");
    expect(migration).toContain("job.job_kind <> 'connector_agent_run'");
    expect(migration).toContain("candidate.config->>'agent_id' = _agent_id");
    expect(migration).toContain("config->>'agent_id' ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'");
    expect(migration).toContain("'connectors.agent' = ANY(token.scopes)");
    expect(migration).not.toMatch(/schedule\.config\s+AS\s+config/iu);
    for (const forbidden of ["password", "private_key", "bearer_token"]) {
      expect(migration).not.toContain(`schedule.config->'${forbidden}'`);
    }
  });

  it("keeps lease, completion and failure RPCs service-role only", async () => {
    const migration = await readFile("supabase/migrations/20260906014500_add_connector_agent_queue.sql", "utf8");
    for (const fn of ["claim_connector_agent_job", "complete_connector_agent_job", "fail_connector_agent_job"]) {
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([\\s\\S]+?FROM PUBLIC, anon, authenticated;`, "u"));
      expect(migration).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([\\s\\S]+?TO service_role;`, "u"));
    }
  });
});
