/**
 * End-to-end plugin lifecycle test.
 *
 * Walks the full marketplace path: install an example plugin into a tenant,
 * load its tools via the Copilot plugin loader, invoke the tool, and verify:
 *
 *   1. The external side effect (HTTP call) is recorded with the right
 *      tenant-scoped config and tool input.
 *   2. A success row lands in `copilot_plugin_tool_audit` with redacted I/O.
 *   3. When the external system fails (non-2xx + thrown error), the loader
 *      remains usable for the next call and an `error` audit row is written
 *      capturing the failure message.
 *
 * Uses an in-test plugin registered into PLUGIN_REGISTRY so the test owns
 * the side-effect surface (a captured `fetch` spy) without depending on a
 * real ServiceNow/Slack/Jira endpoint.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PLUGIN_REGISTRY,
  loadTenantPluginTools,
} from "@/lib/copilot-plugins.server";

// ─── Mock supabase: tenant_copilot_plugins "install" + audit capture ────────
interface InstalledRow {
  plugin_id: string;
  config: unknown;
  enabled: boolean;
}
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

function mockSupa(installed: InstalledRow[], audit: AuditRow[]): SupabaseClient {
  return {
    from(table: string) {
      if (table === "copilot_plugin_tool_audit") {
        return {
          insert(row: AuditRow) {
            audit.push(row);
            return Promise.resolve({ data: null, error: null });
          },
        } as never;
      }
      // tenant_copilot_plugins SELECT chain (.select().eq().eq())
      let enabledFilter: boolean | null = null;
      const builder: Record<string, unknown> = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          if (col === "enabled") enabledFilter = val as boolean;
          return builder;
        },
        then(resolve: (v: unknown) => unknown) {
          const out = installed
            .filter((r) =>
              enabledFilter === null ? true : r.enabled === enabledFilter,
            )
            .map((r) => ({ plugin_id: r.plugin_id, config: r.config }));
          return Promise.resolve({ data: out, error: null }).then(resolve);
        },
      };
      return builder as never;
    },
  } as unknown as SupabaseClient;
}

// ─── Example external plugin registered for this test only ──────────────────
const EXAMPLE_PLUGIN_ID = "__e2e_example_webhook";
const exampleSchema = z.object({
  endpoint_url: z.string().url(),
  api_key_ref: z.string().min(1),
});

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.E2E_PLUGIN_KEY = "test-secret-value";
  fetchSpy = vi.fn();
  // Inject our spy as global fetch so plugin execute() observes it.
  vi.stubGlobal("fetch", fetchSpy);

  PLUGIN_REGISTRY[EXAMPLE_PLUGIN_ID] = {
    id: EXAMPLE_PLUGIN_ID,
    label: "E2E · Example webhook",
    description: "Test-only plugin that posts to an external webhook.",
    requires: ["endpoint_url", "api_key_ref"],
    inputSchema: exampleSchema,
    buildTools(rawConfig) {
      const config = exampleSchema.parse(rawConfig);
      const apiKey = process.env[config.api_key_ref] ?? "";
      return {
        example_send_event: tool({
          description: "Posts a payload to the tenant's configured endpoint.",
          inputSchema: z.object({
            event_name: z.string().min(1).max(120),
            payload: z.record(z.string(), z.unknown()).default({}),
          }),
          async execute(input) {
            const res = (await fetch(config.endpoint_url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                event_name: input.event_name,
                payload: input.payload,
              }),
            })) as Response;
            if (!res.ok) {
              throw new Error(
                `upstream ${res.status}: ${await res.text().catch(() => "")}`,
              );
            }
            return { status: "delivered" as const, http_status: res.status };
          },
        }),
      };
    },
  };
});

afterEach(() => {
  delete PLUGIN_REGISTRY[EXAMPLE_PLUGIN_ID];
  delete process.env.E2E_PLUGIN_KEY;
  vi.unstubAllGlobals();
});

describe("Copilot plugin E2E lifecycle", () => {
  it("installs a plugin, invokes the tool, records the side effect, and writes a success audit row", async () => {
    const installed: InstalledRow[] = [
      {
        plugin_id: EXAMPLE_PLUGIN_ID,
        enabled: true,
        config: {
          endpoint_url: "https://hooks.example.com/in",
          api_key_ref: "E2E_PLUGIN_KEY",
        },
      },
    ];
    const audit: AuditRow[] = [];
    const supa = mockSupa(installed, audit);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "evt_001" }), { status: 200 }),
    );

    const tools = await loadTenantPluginTools(supa, "tenant-e2e", {
      actorUserId: "user-e2e",
      threadId: "thread-e2e",
    });
    const sendEvent = (tools as Record<string, { execute: (i: unknown) => Promise<unknown> }>)
      .example_send_event;
    expect(sendEvent, "plugin tool should be loaded after install").toBeDefined();

    const out = (await sendEvent.execute({
      event_name: "break.assigned",
      payload: { break_id: "brk_42" },
      authorization: "Bearer leaked-should-be-redacted",
    })) as { status: string; http_status: number };

    // 1. External side effect happened against the tenant-configured URL.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("https://hooks.example.com/in");
    expect((calledInit.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-secret-value",
    );
    expect(JSON.parse(calledInit.body as string)).toEqual({
      event_name: "break.assigned",
      payload: { break_id: "brk_42" },
    });
    expect(out).toEqual({ status: "delivered", http_status: 200 });

    // 2. Audit row written with redaction.
    expect(audit).toHaveLength(1);
    const row = audit[0];
    expect(row.tenant_id).toBe("tenant-e2e");
    expect(row.actor_user_id).toBe("user-e2e");
    expect(row.thread_id).toBe("thread-e2e");
    expect(row.plugin_id).toBe(EXAMPLE_PLUGIN_ID);
    expect(row.tool_name).toBe("example_send_event");
    expect(row.status).toBe("ok");
    expect(row.error_message).toBeNull();
    expect(row.latency_ms).toBeGreaterThanOrEqual(0);
    expect((row.input as Record<string, unknown>).event_name).toBe("break.assigned");
    expect((row.input as Record<string, unknown>).authorization).toBe("[REDACTED]");
  });

  it("records an error audit row when the external system fails, and stays usable on retry", async () => {
    const installed: InstalledRow[] = [
      {
        plugin_id: EXAMPLE_PLUGIN_ID,
        enabled: true,
        config: {
          endpoint_url: "https://hooks.example.com/in",
          api_key_ref: "E2E_PLUGIN_KEY",
        },
      },
    ];
    const audit: AuditRow[] = [];
    const supa = mockSupa(installed, audit);

    // First call: upstream 503. Second call: recovery 200.
    fetchSpy
      .mockResolvedValueOnce(new Response("service unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const tools = await loadTenantPluginTools(supa, "tenant-e2e", {
      actorUserId: "user-e2e",
    });
    const sendEvent = (tools as Record<string, { execute: (i: unknown) => Promise<unknown> }>)
      .example_send_event;

    await expect(
      sendEvent.execute({ event_name: "break.assigned", payload: {} }),
    ).rejects.toThrow(/upstream 503/);

    // Failure audit row captured.
    expect(audit).toHaveLength(1);
    expect(audit[0].status).toBe("error");
    expect(audit[0].error_message).toMatch(/upstream 503/);
    expect(audit[0].output).toBeNull();

    // Loader remained usable — retry succeeds and is audited as ok.
    const out = (await sendEvent.execute({
      event_name: "break.assigned",
      payload: { retry: true },
    })) as { status: string };
    expect(out.status).toBe("delivered");
    expect(audit).toHaveLength(2);
    expect(audit[1].status).toBe("ok");
    expect(audit[1].error_message).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("skips the plugin when install config is invalid (missing required key) — no tools, no side effect", async () => {
    const installed: InstalledRow[] = [
      {
        plugin_id: EXAMPLE_PLUGIN_ID,
        enabled: true,
        // missing api_key_ref → validatePluginConfig must reject
        config: { endpoint_url: "https://hooks.example.com/in" },
      },
    ];
    const audit: AuditRow[] = [];
    const supa = mockSupa(installed, audit);

    const tools = await loadTenantPluginTools(supa, "tenant-e2e", {
      actorUserId: "user-e2e",
    });

    expect((tools as Record<string, unknown>).example_send_event).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(audit).toHaveLength(0);
  });
});
