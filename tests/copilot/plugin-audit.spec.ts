/**
 * Audit logging for every tenant marketplace plugin tool call.
 *
 * Verifies that loadTenantPluginTools wraps each plugin tool so a row is
 * written to public.copilot_plugin_tool_audit on every invocation, capturing
 * tenant_id, actor_user_id, plugin_id, tool_name, status, latency, redacted
 * input/output, and (on failure) the error message — for both success and
 * thrown-error paths.
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadTenantPluginTools } from "@/lib/copilot-plugins.server";

beforeAll(() => {
  process.env.SN_API_KEY_ACME = "test-sn-key";
  process.env.JIRA_API_TOKEN = "test-jira-token";
});

interface AuditRow {
  tenant_id: string;
  actor_user_id: string | null;
  thread_id: string | null;
  plugin_id: string;
  tool_name: string;
  status: "ok" | "error";
  latency_ms: number;
  input: unknown;
  output: unknown;
  error_message: string | null;
}

function mockSupa(
  rows: Array<{ plugin_id: string; config: unknown; enabled: boolean }>,
  audit: AuditRow[],
): SupabaseClient {
  return {
    from(table: string) {
      if (table === "copilot_plugin_tool_audit") {
        return {
          insert(row: AuditRow) {
            audit.push(row);
            return Promise.resolve({ data: null, error: null });
          },
        } as any;
      }
      let enabledFilter: boolean | null = null;
      const builder: any = {
        select() { return builder; },
        eq(col: string, val: unknown) {
          if (col === "enabled") enabledFilter = val as boolean;
          return builder;
        },
        then(resolve: any) {
          const out = rows
            .filter((r) => (enabledFilter === null ? true : r.enabled === enabledFilter))
            .map((r) => ({ plugin_id: r.plugin_id, config: r.config }));
          return Promise.resolve({ data: out, error: null }).then(resolve);
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const SN_CFG = {
  instance_url: "https://acme.service-now.com",
  api_key_ref: "SN_API_KEY_ACME",
};

describe("Plugin tool audit logging", () => {
  it("writes an audit row on a successful tool call with actor + tenant + redacted input", async () => {
    const audit: AuditRow[] = [];
    const supa = mockSupa(
      [{ plugin_id: "servicenow-create-incident", config: SN_CFG, enabled: true }],
      audit,
    );
    const tools = await loadTenantPluginTools(supa, "tenant-a", {
      actorUserId: "user-1",
      threadId: "thread-1",
    });
    const sn = (tools as any).servicenow_create_incident;
    expect(sn).toBeDefined();

    await sn.execute({
      short_description: "Mismatch on USD nostro",
      description: "AUTO: review break #42",
      urgency: "2",
      api_token: "sk-should-be-redacted",
    });

    expect(audit).toHaveLength(1);
    const row = audit[0];
    expect(row.tenant_id).toBe("tenant-a");
    expect(row.actor_user_id).toBe("user-1");
    expect(row.thread_id).toBe("thread-1");
    expect(row.plugin_id).toBe("servicenow-create-incident");
    expect(row.tool_name).toBe("servicenow_create_incident");
    expect(row.status).toBe("ok");
    expect(row.latency_ms).toBeGreaterThanOrEqual(0);
    expect((row.input as any).api_token).toBe("[REDACTED]");
    expect((row.input as any).short_description).toBe("Mismatch on USD nostro");
    expect(row.output).toBeTruthy();
    expect(row.error_message).toBeNull();
  });

  it("writes an error audit row when the underlying tool throws", async () => {
    const { PLUGIN_REGISTRY } = await import("@/lib/copilot-plugins.server");
    const { tool } = await import("ai");
    const { z } = await import("zod");
    PLUGIN_REGISTRY["__test_throws"] = {
      id: "__test_throws",
      label: "test",
      description: "test",
      requires: [],
      inputSchema: z.object({}),
      buildTools() {
        return {
          test_throws: tool({
            description: "always throws",
            inputSchema: z.object({ x: z.string() }),
            async execute() {
              throw new Error("boom: upstream 500");
            },
          }),
        };
      },
    };

    const audit: AuditRow[] = [];
    const supa = mockSupa(
      [{ plugin_id: "__test_throws", config: {}, enabled: true }],
      audit,
    );
    const tools = await loadTenantPluginTools(supa, "tenant-b", {
      actorUserId: "user-2",
    });
    await expect(
      (tools as any).test_throws.execute({ x: "hi" }),
    ).rejects.toThrow("boom: upstream 500");

    expect(audit).toHaveLength(1);
    expect(audit[0].status).toBe("error");
    expect(audit[0].error_message).toContain("boom");
    expect(audit[0].output).toBeNull();
    expect(audit[0].actor_user_id).toBe("user-2");
    expect(audit[0].tenant_id).toBe("tenant-b");

    delete PLUGIN_REGISTRY["__test_throws"];
  });


  it("does not write audit rows when tenantId is null (loader returns {} early)", async () => {
    const audit: AuditRow[] = [];
    const supa = mockSupa([], audit);
    const tools = await loadTenantPluginTools(supa, null, {
      actorUserId: "user-3",
    });
    expect(Object.keys(tools)).toHaveLength(0);
    expect(audit).toHaveLength(0);
  });
});
