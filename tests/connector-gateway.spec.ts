import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import worker from "../workers/connector-gateway/src/index";
import { GATEWAY_TYPES, runGatewayConnector } from "../workers/connector-gateway/src/adapters";

describe("private connector gateway", () => {
  it("publishes all ten gateway capabilities without a public route", async () => {
    expect(GATEWAY_TYPES).toEqual([
      "s3",
      "azure_blob",
      "gcs",
      "bigquery",
      "snowflake",
      "databricks",
      "sftp",
      "ftp",
      "local",
      "network_drive",
    ]);
    const response = await worker.fetch(new Request("https://gateway.internal/health"));
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      connector_types: GATEWAY_TYPES,
    });
  });

  it.each([
    ["s3", "https://assurance.s3.amazonaws.com/records.csv"],
    ["azure_blob", "https://assurance.blob.core.windows.net/input/records.csv"],
    ["gcs", "https://storage.googleapis.com/assurance/records.csv"],
  ] as const)("pulls and parses %s object data", async (connectorType, url) => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("id,amount\nA1,125.50\n", {
          headers: { "content-type": "text/csv" },
        }),
    ) as unknown as typeof fetch;
    await expect(
      runGatewayConnector({ connector_type: connectorType, config: { url } }, fetchImpl),
    ).resolves.toEqual({
      rows: [{ id: "A1", amount: "125.50" }],
      columns: ["id", "amount"],
    });
  });

  it("normalizes BigQuery REST rows", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        schema: { fields: [{ name: "trade_id" }, { name: "amount" }] },
        rows: [{ f: [{ v: "T-1" }, { v: "900" }] }],
      }),
    ) as unknown as typeof fetch;
    await expect(
      runGatewayConnector(
        {
          connector_type: "bigquery",
          config: { project_id: "fvi-assurance", query: "select trade_id, amount from assurance" },
          credential: JSON.stringify({ bearer_token: "test-only" }),
        },
        fetchImpl,
      ),
    ).resolves.toMatchObject({ rows: [{ trade_id: "T-1", amount: "900" }] });
  });

  it("normalizes Snowflake SQL API rows", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        resultSetMetaData: { rowType: [{ name: "TRADE_ID" }, { name: "AMOUNT" }] },
        data: [["T-2", "901"]],
      }),
    ) as unknown as typeof fetch;
    await expect(
      runGatewayConnector(
        {
          connector_type: "snowflake",
          config: {
            account_host: "assurance.eu-west-1.snowflakecomputing.com",
            statement: "select * from assurance",
          },
          credential: JSON.stringify({ token: "test-only" }),
        },
        fetchImpl,
      ),
    ).resolves.toMatchObject({ rows: [{ TRADE_ID: "T-2", AMOUNT: "901" }] });
  });

  it("normalizes Databricks statement rows", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        manifest: { schema: { columns: [{ name: "trade_id" }, { name: "amount" }] } },
        result: { data_array: [["T-3", "902"]] },
      }),
    ) as unknown as typeof fetch;
    await expect(
      runGatewayConnector(
        {
          connector_type: "databricks",
          config: {
            workspace_host: "assurance.cloud.databricks.com",
            warehouse_id: "wh-1",
            statement: "select * from assurance",
          },
          credential: JSON.stringify({ token: "test-only" }),
        },
        fetchImpl,
      ),
    ).resolves.toMatchObject({ rows: [{ trade_id: "T-3", amount: "902" }] });
  });

  it.each(["sftp", "ftp", "local", "network_drive"] as const)(
    "keeps %s on the isolated agent boundary",
    async (connectorType) => {
      await expect(
        runGatewayConnector({ connector_type: connectorType, config: {} }),
      ).rejects.toThrow("connector_agent_required");
    },
  );

  it("rejects private and cross-provider endpoints", async () => {
    await expect(
      runGatewayConnector({ connector_type: "s3", config: { url: "https://127.0.0.1/secrets" } }),
    ).rejects.toThrow("not_allowed");
    await expect(
      runGatewayConnector({
        connector_type: "azure_blob",
        config: { url: "https://attacker.example/file.csv" },
      }),
    ).rejects.toThrow("not_allowed");
  });

  it("queues only direct and implemented remote gateway types", async () => {
    const migration = await readFile(
      "supabase/migrations/20260905221500_enable_remote_gateway_connector_queue.sql",
      "utf8",
    );
    for (const type of ["s3", "azure_blob", "gcs", "bigquery", "snowflake", "databricks"]) {
      expect(migration).toContain(`'${type}'`);
    }
    expect(migration).not.toMatch(/connector_type IN \([^)]*'sftp'/su);
    expect(migration).not.toMatch(/connector_type IN \([^)]*'ftp'/su);
    expect(migration).not.toMatch(/connector_type IN \([^)]*'local'/su);
    expect(migration).not.toMatch(/connector_type IN \([^)]*'network_drive'/su);
  });

  it("loads the vault only when a credential reference is present", async () => {
    const source = await readFile("src/lib/connector-gateway-service.server.ts", "utf8");
    expect(source).not.toMatch(/^import .*vault-resolver\.server/mu);
    expect(source).toContain('import("@/lib/vault-resolver.server")');
  });
});
