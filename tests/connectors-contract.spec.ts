import { describe, expect, it } from "vitest";
import {
  CONNECTOR_EXECUTION_MODES,
  CONNECTOR_TYPES,
  connectorExecutionMode,
} from "@/lib/connectors.functions";
import {
  connectorRunAuditRecord,
  DIRECT_HTTP_CONNECTOR_TYPES,
  supportsDirectHttpPull,
} from "@/lib/connectors.server";
import { scheduledConnectorAgentIdempotencyKey } from "@/routes/api/public/cron/run-schedules";

describe("scheduled connector contract", () => {
  it("keeps the application validator aligned with the database connector constraint", () => {
    expect(CONNECTOR_TYPES).toEqual([
      "sftp",
      "ftp",
      "s3",
      "azure_blob",
      "gcs",
      "bigquery",
      "snowflake",
      "databricks",
      "http",
      "https",
      "rest",
      "local",
      "network_drive",
      "manual",
    ]);
  });

  it("executes all HTTP-family connector labels through the direct adapter", () => {
    expect(DIRECT_HTTP_CONNECTOR_TYPES).toEqual(["http", "https", "rest"]);
    for (const type of DIRECT_HTTP_CONNECTOR_TYPES) {
      expect(supportsDirectHttpPull(type)).toBe(true);
    }
    expect(supportsDirectHttpPull("sftp")).toBe(false);
  });

  it("publishes truthful execution modes for every advertised connector", () => {
    expect(Object.keys(CONNECTOR_EXECUTION_MODES).sort()).toEqual([...CONNECTOR_TYPES].sort());
    expect(connectorExecutionMode("http")).toBe("direct");
    expect(connectorExecutionMode("manual")).toBe("manual");
    for (const type of ["s3", "azure_blob", "gcs", "bigquery", "snowflake", "databricks"]) {
      expect(connectorExecutionMode(type)).toBe("remote_gateway");
    }
    for (const type of ["sftp", "ftp", "local", "network_drive"]) {
      expect(connectorExecutionMode(type)).toBe("agent_required");
    }
  });

  it("correlates API connector execution with its actor, token, and workflow job", () => {
    expect(
      connectorRunAuditRecord("tenant-1", "schedule-1", 10, "manual", {
        actorUserId: "actor-1",
        workflowJobId: "job-1",
        apiTokenId: "token-1",
      }),
    ).toMatchObject({
      actor_user_id: "actor-1",
      tenant_id: "tenant-1",
      action: "connector.run",
      resource_id: "schedule-1",
      context: {
        rows: 10,
        trigger: "manual",
        workflow_job_id: "job-1",
        api_token_id: "token-1",
      },
    });
  });

  it("deduplicates scheduled agent work within one UTC minute", () => {
    const first = scheduledConnectorAgentIdempotencyKey(
      "00000000-0000-4000-8000-000000000001",
      new Date("2026-09-06T02:15:01.000Z"),
    );
    const retry = scheduledConnectorAgentIdempotencyKey(
      "00000000-0000-4000-8000-000000000001",
      new Date("2026-09-06T02:15:59.999Z"),
    );
    const next = scheduledConnectorAgentIdempotencyKey(
      "00000000-0000-4000-8000-000000000001",
      new Date("2026-09-06T02:16:00.000Z"),
    );
    expect(first).toBe(retry);
    expect(next).not.toBe(first);
  });
});
