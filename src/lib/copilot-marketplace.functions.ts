/**
 * Phase 5 — Copilot marketplace catalog server functions.
 *
 * Backs `/_authenticated/$slug/tenant/settings/marketplace` so tenant
 * admins can browse the registered Copilot plugins and install /
 * configure / enable / disable / uninstall them. All writes are gated
 * by the RLS policies on `public.tenant_copilot_plugins` (tenant_admin
 * only — see migration in Phase 4).
 *
 * NOTE: A separate `src/lib/marketplace.functions.ts` powers the
 * sandboxed WASM marketplace (Listings / Installs / Ratings). This file
 * is dedicated to Copilot tool plugins so the two surfaces stay
 * independent.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { PLUGIN_REGISTRY } from "@/lib/copilot-plugins.server";

export type CopilotMarketplaceItem = {
  plugin_id: string;
  label: string;
  description: string;
  requires: string[];
  installed: boolean;
  enabled: boolean;
  installed_at: string | null;
};

const tenantIdInput = z.object({ tenant_id: z.string().uuid() });

export const listMarketplacePlugins = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => tenantIdInput.parse(d))
  .handler(async ({ data, context }): Promise<CopilotMarketplaceItem[]> => {
    const { data: rows, error } = await context.supabase
      .from("tenant_copilot_plugins")
      .select("plugin_id, enabled, installed_at")
      .eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);

    const byId = new Map<string, { enabled: boolean; installed_at: string }>(
      (rows ?? []).map((r) => [r.plugin_id, { enabled: r.enabled, installed_at: r.installed_at }]),
    );

    return Object.values(PLUGIN_REGISTRY).map((p) => {
      const inst = byId.get(p.id) ?? null;
      return {
        plugin_id: p.id,
        label: p.label,
        description: p.description,
        requires: p.requires,
        installed: !!inst,
        enabled: inst?.enabled ?? false,
        installed_at: inst?.installed_at ?? null,
      };
    });
  });

const installInput = z.object({
  tenant_id: z.string().uuid(),
  plugin_id: z.string().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const installPlugin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => installInput.parse(d))
  .handler(async ({ data, context }) => {
    const reg = PLUGIN_REGISTRY[data.plugin_id];
    if (!reg) throw new Error(`Unknown plugin: ${data.plugin_id}`);
    // Server-side schema validation: never persist invalid config.
    const parsed = reg.inputSchema.safeParse(data.config);
    if (!parsed.success) {
      throw new Error(
        `Invalid configuration: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      );
    }
    const { error } = await context.supabase
      .from("tenant_copilot_plugins")
      .upsert(
        {
          tenant_id: data.tenant_id,
          plugin_id: data.plugin_id,
          config: parsed.data,
          enabled: true,
          installed_by: context.userId,
        },
        { onConflict: "tenant_id,plugin_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const togglePluginInput = z.object({
  tenant_id: z.string().uuid(),
  plugin_id: z.string().min(1),
});

export const enablePlugin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => togglePluginInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("tenant_copilot_plugins")
      .update({ enabled: true })
      .eq("tenant_id", data.tenant_id)
      .eq("plugin_id", data.plugin_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const disablePlugin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => togglePluginInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("tenant_copilot_plugins")
      .update({ enabled: false })
      .eq("tenant_id", data.tenant_id)
      .eq("plugin_id", data.plugin_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const uninstallPlugin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => togglePluginInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("tenant_copilot_plugins")
      .delete()
      .eq("tenant_id", data.tenant_id)
      .eq("plugin_id", data.plugin_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
