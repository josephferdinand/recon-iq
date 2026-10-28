/**
 * Phase 4 — Marketplace plugin loader tests.
 *
 * Verifies the loader integrates `tenant_copilot_plugins` rows with the
 * static `PLUGIN_REGISTRY` and produces the right tool surface for the
 * downstream `streamText` call. Four contract fixtures:
 *
 *   1. Plugin registered + tenant has it enabled  → tool IS in list.
 *   2. Plugin registered + tenant has it disabled → tool is NOT in list.
 *   3. plugin_id not in registry                  → silently skipped.
 *   4. Tenant with no plugins                     → base read+write only.
 *
 * The mock supabase honours `.eq("enabled", true)` semantics by only
 * returning the rows the caller would receive in the real client.
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadTenantPluginTools,
  PLUGIN_REGISTRY,
} from "@/lib/copilot-plugins.server";

beforeAll(() => {
  process.env.SN_API_KEY_ACME = "test-sn-key";
  process.env.JIRA_API_TOKEN = "test-jira-token";
});

function mockSupaWithRows(rows: Array<{ plugin_id: string; config: unknown; enabled: boolean }>): SupabaseClient {
  return {
    from(_table: string) {
      let enabledFilter: boolean | null = null;
      const builder: any = {
        select() { return builder; },
        eq(col: string, val: unknown) {
          if (col === "enabled") enabledFilter = val as boolean;
          return builder;
        },
        then(resolve: any) {
          const out = rows.filter((r) =>
            enabledFilter === null ? true : r.enabled === enabledFilter,
          ).map((r) => ({ plugin_id: r.plugin_id, config: r.config }));
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
const SLACK_CFG = { webhook_url: "https://hooks.slack.com/abc" };

describe("Phase 4 — marketplace plugin loader", () => {
  it("registry seeded with the three example plugins", () => {
    expect(Object.keys(PLUGIN_REGISTRY).sort()).toEqual([
      "jira-create-ticket",
      "servicenow-create-incident",
      "slack-post-to-channel",
    ]);
  });

  it("(1) registered + enabled → tool appears in the LLM tool list", async () => {
    const supa = mockSupaWithRows([
      { plugin_id: "servicenow-create-incident", config: SN_CFG, enabled: true },
    ]);
    const tools = await loadTenantPluginTools(supa, "tenant-a");
    expect(Object.keys(tools)).toContain("servicenow_create_incident");
  });

  it("(2) registered but disabled → tool is NOT in the LLM tool list", async () => {
    const supa = mockSupaWithRows([
      { plugin_id: "servicenow-create-incident", config: SN_CFG, enabled: false },
    ]);
    const tools = await loadTenantPluginTools(supa, "tenant-a");
    expect(tools).toEqual({});
  });

  it("(3) plugin_id not in registry → silently skipped", async () => {
    const supa = mockSupaWithRows([
      { plugin_id: "from-the-future", config: {}, enabled: true },
      { plugin_id: "slack-post-to-channel", config: SLACK_CFG, enabled: true },
    ]);
    const tools = await loadTenantPluginTools(supa, "tenant-a");
    expect(Object.keys(tools)).toEqual(["slack_post_message"]);
  });

  it("(4) tenant with no plugins → empty plugin tool list", async () => {
    const supa = mockSupaWithRows([]);
    const tools = await loadTenantPluginTools(supa, "tenant-a");
    expect(tools).toEqual({});
  });

  it("null tenant_id short-circuits without querying", async () => {
    let called = false;
    const supa = {
      from() { called = true; return {} as any; },
    } as unknown as SupabaseClient;
    const tools = await loadTenantPluginTools(supa, null);
    expect(tools).toEqual({});
    expect(called).toBe(false);
  });

  it("invalid config does not throw — plugin is skipped with a warning", async () => {
    const supa = mockSupaWithRows([
      { plugin_id: "servicenow-create-incident", config: { nope: 1 }, enabled: true },
      { plugin_id: "slack-post-to-channel", config: SLACK_CFG, enabled: true },
    ]);
    const tools = await loadTenantPluginTools(supa, "tenant-a");
    expect(Object.keys(tools)).toEqual(["slack_post_message"]);
  });
});
