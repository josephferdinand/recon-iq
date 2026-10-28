/**
 * Phase 4 — Copilot Marketplace Plugins (registry + loader).
 *
 * Per-tenant Copilot tools that can be installed from a marketplace without
 * changing core code per tenant. Each plugin is a self-describing module
 * that, given tenant-supplied config, returns one or more AI SDK tools.
 *
 * Governance:
 *   - Plugins are loaded based on rows in `public.tenant_copilot_plugins`
 *     filtered to enabled=true; RLS already scopes the read to the caller.
 *   - Mutating plugin tools MUST set needsApproval and inherit the same
 *     4-eyes governance as built-in write tools (Phase 2). See ServiceNow
 *     and Jira tools below — Slack-post is treated as low-risk advisory.
 *   - Secrets referenced in `config.*_secret_ref` MUST resolve via
 *     `process.env[ref]` on the server only; raw secrets must never appear
 *     in `config` and are never echoed in tool inputs/outputs.
 */
import { z } from "zod";
import { tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Plugin registry contract ───────────────────────────────────────────────
export interface CopilotPlugin {
  id: string;
  label: string;
  description: string;
  /**
   * Required config keys that MUST be present (and non-empty) on the
   * tenant-supplied `config` blob before `buildTools` is invoked. Keys ending
   * in `_ref` are additionally validated to point at a defined `process.env`
   * entry on the server.
   */
  requires: string[];
  /** zod schema validating the per-tenant `config` blob. */
  inputSchema: z.ZodObject<z.ZodRawShape>;
  /** returns AI SDK tools, keyed by tool name. */
  buildTools: (config: unknown) => Record<string, unknown>;
}

/**
 * Runtime validation of a tenant's plugin `config` against the plugin's
 * `requires` list and `inputSchema`. Throws a descriptive Error on the first
 * failure so the loader can skip the plugin and surface a single warning.
 */
export function validatePluginConfig(
  plugin: CopilotPlugin,
  rawConfig: unknown,
): Record<string, unknown> {
  if (rawConfig == null || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    throw new Error(`config must be a JSON object for plugin "${plugin.id}"`);
  }
  const cfg = rawConfig as Record<string, unknown>;

  // 1. `requires` presence + non-empty check (runs BEFORE zod for clearer errors).
  const missing = plugin.requires.filter((key) => {
    const v = cfg[key];
    return v == null || (typeof v === "string" && v.trim() === "");
  });
  if (missing.length > 0) {
    throw new Error(
      `missing required config key(s) for plugin "${plugin.id}": ${missing.join(", ")}`,
    );
  }

  // 2. Zod schema validation (types, formats, enums).
  const parsed = plugin.inputSchema.parse(cfg) as Record<string, unknown>;

  // 3. Any `*_ref` field MUST resolve to a defined process.env entry.
  const unresolved: string[] = [];
  for (const [key, val] of Object.entries(parsed)) {
    if (!key.endsWith("_ref") || typeof val !== "string") continue;
    const envVal = process.env[val];
    if (envVal == null || envVal === "") unresolved.push(`${key}→${val}`);
  }
  if (unresolved.length > 0) {
    throw new Error(
      `unresolved env-var reference(s) for plugin "${plugin.id}": ${unresolved.join(", ")}`,
    );
  }

  return parsed;
}

// ─── 1. ServiceNow — Create Incident ────────────────────────────────────────
const servicenowSchema = z.object({
  instance_url: z.string().url(),
  api_key_ref: z.string().min(1), // env var name, e.g. SN_API_KEY_ACME
});

const servicenowPlugin: CopilotPlugin = {
  id: "servicenow-create-incident",
  label: "ServiceNow · Create incident",
  description:
    "Creates a ServiceNow incident with title, description, and urgency. Requires approval.",
  requires: ["instance_url", "api_key_ref"],
  inputSchema: servicenowSchema,
  buildTools(rawConfig) {
    const config = servicenowSchema.parse(rawConfig);
    return {
      servicenow_create_incident: tool({
        description:
          "Create a ServiceNow incident. ALWAYS returns awaiting_approval — never executes immediately.",
        inputSchema: z.object({
          short_description: z.string().min(3).max(160),
          description: z.string().min(3).max(4000),
          urgency: z.enum(["1", "2", "3"]).default("3"),
        }),
        async execute(input) {
          return {
            status: "awaiting_approval" as const,
            plugin: "servicenow-create-incident",
            preview: {
              instance: config.instance_url,
              short_description: input.short_description,
              urgency: input.urgency,
            },
            message:
              "ServiceNow incident creation requires 4-eyes approval. A second user must approve.",
          };
        },
      }),
    };
  },
};

// ─── 2. Slack — Post to channel ─────────────────────────────────────────────
const slackSchema = z.object({
  webhook_url: z.string().url(),
  default_channel: z.string().optional(),
});

const slackPlugin: CopilotPlugin = {
  id: "slack-post-to-channel",
  label: "Slack · Post to channel",
  description: "Posts an advisory message to a Slack channel via webhook.",
  requires: ["webhook_url"],
  inputSchema: slackSchema,
  buildTools(rawConfig) {
    const config = slackSchema.parse(rawConfig);
    return {
      slack_post_message: tool({
        description:
          "Post an advisory message to the tenant's Slack channel via configured webhook.",
        inputSchema: z.object({
          message: z.string().min(1).max(2000),
          channel: z.string().optional(),
        }),
        async execute(input) {
          return {
            status: "awaiting_approval" as const,
            plugin: "slack-post-to-channel",
            preview: {
              channel: input.channel ?? config.default_channel ?? "(default)",
              message: input.message.slice(0, 200),
            },
            message:
              "Slack post requires confirmation. A second user must approve before the message is sent.",
          };
        },
      }),
    };
  },
};

// ─── 3. Jira — Create ticket ────────────────────────────────────────────────
const jiraSchema = z.object({
  base_url: z.string().url(),
  project_key: z.string().min(1),
  api_token_ref: z.string().min(1),
});

const jiraPlugin: CopilotPlugin = {
  id: "jira-create-ticket",
  label: "Jira · Create ticket",
  description:
    "Creates a Jira issue in the configured project. Requires approval.",
  requires: ["base_url", "project_key", "api_token_ref"],
  inputSchema: jiraSchema,
  buildTools(rawConfig) {
    const config = jiraSchema.parse(rawConfig);
    return {
      jira_create_ticket: tool({
        description:
          "Create a Jira issue. ALWAYS returns awaiting_approval — never executes immediately.",
        inputSchema: z.object({
          summary: z.string().min(3).max(255),
          description: z.string().min(3).max(8000),
          issue_type: z.enum(["Bug", "Task", "Story"]).default("Task"),
        }),
        async execute(input) {
          return {
            status: "awaiting_approval" as const,
            plugin: "jira-create-ticket",
            preview: {
              project: config.project_key,
              base_url: config.base_url,
              summary: input.summary,
              issue_type: input.issue_type,
            },
            message:
              "Jira ticket creation requires 4-eyes approval. A second user must approve.",
          };
        },
      }),
    };
  },
};

// ─── Registry export ────────────────────────────────────────────────────────
export const PLUGIN_REGISTRY: Record<string, CopilotPlugin> = {
  [servicenowPlugin.id]: servicenowPlugin,
  [slackPlugin.id]: slackPlugin,
  [jiraPlugin.id]: jiraPlugin,
};

export type TenantPluginRow = { plugin_id: string; config: unknown };

/**
 * Phase 4 loader — given an authenticated supabase client and the current
 * tenant, returns the AI SDK tools contributed by all enabled plugins.
 *
 * Unknown plugin_ids are skipped silently (forward-compat with marketplace
 * versions newer than this build). Invalid config is also skipped, with a
 * single console warning, so a misconfigured plugin never blocks the chat.
 */
export async function loadTenantPluginTools(
  supabase: SupabaseClient,
  tenantId: string | null,
  audit?: { actorUserId: string | null; threadId?: string | null },
): Promise<Record<string, unknown>> {
  if (!tenantId) return {};
  const { data, error } = await supabase
    .from("tenant_copilot_plugins")
    .select("plugin_id, config")
    .eq("tenant_id", tenantId)
    .eq("enabled", true);
  if (error) {
    console.warn("[copilot-plugins] load failed:", error.message);
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const row of (data as TenantPluginRow[] | null) ?? []) {
    const reg = PLUGIN_REGISTRY[row.plugin_id];
    if (!reg) continue; // forward-compat: unknown plugin id
    try {
      // Runtime gate: validate config against `requires` + inputSchema + env refs
      // BEFORE buildTools is invoked. Failure skips this plugin only.
      const validated = validatePluginConfig(reg, row.config);
      const tools = reg.buildTools(validated);
      for (const [toolName, t] of Object.entries(tools)) {
        const wrapped = t as { execute?: (input: unknown) => Promise<unknown> };
        if (typeof wrapped.execute !== "function") continue;
        const originalExecute = wrapped.execute.bind(wrapped);
        wrapped.execute = async (input: unknown) => {
          const startedAt = Date.now();
          let status: "ok" | "error" = "ok";
          let output: unknown = null;
          let errorMessage: string | null = null;
          try {
            output = await originalExecute(input);
            return output;
          } catch (err) {
            status = "error";
            errorMessage = (err as Error)?.message ?? String(err);
            throw err;
          } finally {
            try {
              await supabase.from("copilot_plugin_tool_audit").insert({
                tenant_id: tenantId,
                actor_user_id: audit?.actorUserId ?? null,
                thread_id: audit?.threadId ?? null,
                plugin_id: row.plugin_id,
                tool_name: toolName,
                status,
                latency_ms: Date.now() - startedAt,
                input: redactJson(input),
                output: status === "ok" ? redactJson(output) : null,
                error_message: errorMessage,
              });
            } catch (logErr) {
              console.warn(
                "[copilot-plugins] audit write failed:",
                (logErr as Error).message,
              );
            }
          }
        };
      }
      Object.assign(out, tools);
    } catch (e) {
      console.warn(
        `[copilot-plugins] plugin "${row.plugin_id}" skipped (invalid config):`,
        (e as Error).message,
      );
    }
  }
  return out;
}

// ─── Redaction + size cap (defence-in-depth; secrets must already be refs) ──
const MAX_JSON_BYTES = 8 * 1024;
const SECRET_KEY_RE = /(secret|token|api[_-]?key|password|authorization)/i;

function redactJson(value: unknown): unknown {
  const cloned = redactDeep(value, 0);
  try {
    const s = JSON.stringify(cloned);
    if (s.length > MAX_JSON_BYTES) {
      return { _truncated: true, preview: s.slice(0, MAX_JSON_BYTES) };
    }
    return cloned;
  } catch {
    return { _unserializable: true };
  }
}

function redactDeep(v: unknown, depth: number): unknown {
  if (depth > 6 || v == null) return v;
  if (Array.isArray(v)) return v.map((x) => redactDeep(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) ? "[REDACTED]" : redactDeep(val, depth + 1);
    }
    return out;
  }
  return v;
}

