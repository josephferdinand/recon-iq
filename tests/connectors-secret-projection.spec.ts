import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  projectScheduleRun,
  projectScheduleSummary,
} from "@/lib/connectors.functions";
import {
  preserveExistingScheduleCredentials,
  redactScheduleConfigForEditor,
  readScheduleSettingsForEditor,
} from "@/lib/connectors-schedule-editor.server";

function fakeSupabase({ member, schedule, scheduleError = null }: {
  member: { role: string; active: boolean } | null;
  schedule?: Record<string, unknown> | null;
  scheduleError?: { message: string } | null;
}) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const client = {
    from(table: string) {
      const builder = {
        select(...args: unknown[]) { calls.push({ table, method: "select", args }); return builder; },
        eq(...args: unknown[]) { calls.push({ table, method: "eq", args }); return builder; },
        async maybeSingle() {
          calls.push({ table, method: "maybeSingle", args: [] });
          return table === "tenant_members"
            ? { data: member, error: null }
            : { data: schedule ?? null, error: scheduleError };
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, calls };
}

describe("scheduled connector secret boundaries", () => {
  it("projects list data through an explicit allowlist despite secret and unexpected fields", () => {
    const sourceRecord = {
      id: "schedule-id",
      name: "Payroll SFTP",
      connector_type: "sftp",
      cron_expression: "0 2 * * *",
      enabled: true,
      last_run_at: "2026-09-24T02:00:00Z",
      last_status: "failed",
      last_rows_ingested: 0,
      updated_at: "2026-09-24T02:00:00Z",
      data_source: { name: "Payroll" },
      config: { agent_id: "agent-7", credential_ref: "vault/payroll", private_key: "FAKE_PRIVATE_KEY" },
      transformation: [{ op: "derive", expression: "FAKE_TRANSFORM" }],
      created_by: "creator-id",
      last_error: "FAKE_DATABASE_ERROR_SECRET",
    };
    const summary = projectScheduleSummary(sourceRecord);

    expect(summary).toMatchObject({ agent_configured: true, has_error: true, data_source: { name: "Payroll" } });
    for (const omitted of ["config", "transformation", "created_by", "last_error", "private_key"]) {
      expect(summary).not.toHaveProperty(omitted);
    }
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("FAKE_PRIVATE_KEY");
    expect(serialized).not.toContain("FAKE_TRANSFORM");
    expect(serialized).not.toContain("FAKE_DATABASE_ERROR_SECRET");
    expect(serialized).not.toContain("vault/payroll");
  });

  it("returns only a boolean error indicator for run history", () => {
    const summary = projectScheduleRun({
      id: 41,
      started_at: "2026-09-24T02:00:00Z",
      status: "failed",
      rows_ingested: 0,
      error: "FAKE_CREDENTIAL_IN_ERROR_TEXT",
    });
    expect(summary).toEqual({
      id: 41,
      started_at: "2026-09-24T02:00:00Z",
      status: "failed",
      rows_ingested: 0,
      has_error: true,
    });
    expect(JSON.stringify(summary)).not.toContain("FAKE_CREDENTIAL");
  });

  it("denies an active tenant reader before querying secret-capable schedule fields", async () => {
    const { client, calls } = fakeSupabase({
      member: { role: "tenant_viewer", active: true },
      schedule: { config: { private_key: "FAKE_PRIVATE_KEY" } },
    });

    await expect(
      readScheduleSettingsForEditor(client, "reader-id", "tenant-id", "schedule-id"),
    ).rejects.toThrow("You do not have permission to edit this connection.");
    expect(calls.some((call) => call.table === "data_source_schedules")).toBe(false);
  });

  it("denies an inactive tenant administrator before querying schedule settings", async () => {
    const { client, calls } = fakeSupabase({
      member: { role: "tenant_admin", active: false },
      schedule: { config: { private_key: "FAKE_PRIVATE_KEY" } },
    });
    await expect(
      readScheduleSettingsForEditor(client, "inactive-admin-id", "tenant-id", "schedule-id"),
    ).rejects.toThrow("You do not have permission to edit this connection.");
    expect(calls.some((call) => call.table === "data_source_schedules")).toBe(false);
  });

  it("reads the exact tenant-bound schedule only for an active tenant writer", async () => {
    const schedule = {
      id: "schedule-id",
      tenant_id: "tenant-id",
      data_source_id: "source-id",
      name: "Payroll SFTP",
      connector_type: "sftp",
      config: {
        agent_id: "agent-7",
        credential_ref: "vault/payroll",
        private_key: "FAKE_PRIVATE_KEY",
        url: "https://user:FAKE_URL_PASSWORD@example.invalid/feed",
        headers: { Authorization: "Bearer FAKE_AUTHORIZATION_VALUE", Accept: "text/csv" },
      },
      transformation: [{ op: "trim", column: "account" }],
      cron_expression: "0 2 * * *",
      enabled: true,
    };
    const { client, calls } = fakeSupabase({ member: { role: "tenant_admin", active: true }, schedule });

    const response = await readScheduleSettingsForEditor(client, "writer-id", "tenant-id", "schedule-id");
    expect(response).toMatchObject({
      id: schedule.id,
      data_source_id: schedule.data_source_id,
      config: { agent_id: "agent-7", credential_ref: "vault/payroll" },
      sensitive_config_present: true,
    });
    expect(JSON.stringify(response)).not.toContain("FAKE_PRIVATE_KEY");
    expect(JSON.stringify(response)).not.toContain("FAKE_URL_PASSWORD");
    expect(JSON.stringify(response)).not.toContain("FAKE_AUTHORIZATION_VALUE");
    expect(response.config).not.toHaveProperty("private_key");
    expect(response.config.url).toBe("");
    expect(response.sensitive_url_present).toBe(true);
    expect(response.sensitive_headers_present).toBe(true);
    expect(calls.filter((call) => call.table === "data_source_schedules" && call.method === "eq")).toEqual([
      { table: "data_source_schedules", method: "eq", args: ["id", "schedule-id"] },
      { table: "data_source_schedules", method: "eq", args: ["tenant_id", "tenant-id"] },
    ]);
    expect(calls.find((call) => call.table === "data_source_schedules" && call.method === "select")?.args[0])
      .toContain("config,transformation");
  });

  it("preserves legacy secrets server-side and ignores attempted secret edits", async () => {
    const oldUrl = "https://user:FAKE_URL_PASSWORD@example.invalid/feed";
    const redactedUrl = redactScheduleConfigForEditor({ url: oldUrl }).config.url;
    const { client } = fakeSupabase({
      member: { role: "tenant_analyst", active: true },
      schedule: {
        config: {
          host: "sftp.example.invalid",
          private_key: "FAKE_PRIVATE_KEY",
          headers: { Authorization: "FAKE_AUTH_HEADER" },
          url: oldUrl,
        },
      },
    });
    const merged = await preserveExistingScheduleCredentials(
      client,
      "writer-id",
      "tenant-id",
      "schedule-id",
      {
        host: "new-host.example.invalid",
        private_key: "ATTEMPTED_REPLACEMENT_KEY",
        headers: {},
        url: redactedUrl,
      },
    );
    expect(merged).toEqual({
      host: "new-host.example.invalid",
      private_key: "FAKE_PRIVATE_KEY",
      headers: { Authorization: "FAKE_AUTH_HEADER" },
      url: oldUrl,
    });
  });

  it("rejects attempted edits to saved headers instead of silently discarding them", async () => {
    const { client } = fakeSupabase({
      member: { role: "tenant_analyst", active: true },
      schedule: { config: { headers: { "X-Client-Key": "FAKE_OLD_CREDENTIAL" } } },
    });
    await expect(preserveExistingScheduleCredentials(client, "writer-id", "tenant-id", "schedule-id", {
      headers: { "X-Client-Key": "FAKE_NEW_CREDENTIAL" },
    })).rejects.toThrow("Saved connection headers cannot be changed here");
  });

  it("redacts authorization headers and credential-bearing URL components", () => {
    const redacted = redactScheduleConfigForEditor({
      headers: [{ Authorization: "Bearer FAKE_TOKEN" }, { Accept: "text/csv" }],
      url: "https://user:FAKE_PASSWORD@example.invalid/feed?access_token=FAKE_ACCESS_TOKEN",
    });
    expect(redacted.sensitive_config_present).toBe(true);
    expect(redacted.sensitive_headers_present).toBe(true);
    expect(redacted.config.headers).toEqual([]);
    expect(redacted.config.url).toBe("");
    expect(redacted.sensitive_url_present).toBe(true);
    expect(JSON.stringify(redacted)).not.toContain("FAKE_TOKEN");
    expect(JSON.stringify(redacted)).not.toContain("FAKE_PASSWORD");
    expect(JSON.stringify(redacted)).not.toContain("FAKE_ACCESS_TOKEN");
  });

  it("hides arbitrary saved header names and retains them when editing other fields", async () => {
    const config = { headers: { "X-Client-Key": "FAKE_CUSTOM_CREDENTIAL", Accept: "text/csv" }, host: "old.example.invalid" };
    const redacted = redactScheduleConfigForEditor(config);
    expect(redacted.sensitive_headers_present).toBe(true);
    expect(redacted.config.headers).toEqual({});
    expect(JSON.stringify(redacted)).not.toContain("FAKE_CUSTOM_CREDENTIAL");
    const { client } = fakeSupabase({ member: { role: "tenant_admin", active: true }, schedule: { config } });
    const merged = await preserveExistingScheduleCredentials(client, "writer-id", "tenant-id", "schedule-id", {
      ...redacted.config,
      host: "new.example.invalid",
    });
    expect(merged).toEqual({ headers: config.headers, host: "new.example.invalid" });
  });

  it("does not pass database error detail through the exact editor read", async () => {
    const { client } = fakeSupabase({
      member: { role: "tenant_analyst", active: true },
      scheduleError: { message: "FAKE_POSTGREST_SECRET_DETAIL" },
    });
    await expect(readScheduleSettingsForEditor(client, "writer-id", "tenant-id", "schedule-id"))
      .rejects.toThrow("Connection settings are temporarily unavailable. Please try again.");
  });
});
