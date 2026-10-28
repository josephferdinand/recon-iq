import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Unified per-tenant audit view for module/entitlement changes and
 * security-policy updates. Reads audit_log rows written by:
 *   - workspace-visibility.functions.ts      (workspace_page.visibility)
 *   - feature-flags.functions.ts             (feature_flag.update, retention.update)
 *   - platform-ai.functions.ts               (entitlement.update)
 *   - security.functions.ts                  (security.settings.update, security.passkey_policy.update,
 *                                             security.ip_allowlist.add/remove)
 *   - sso.functions.ts via step-up.server.ts (sso.write via requirePrivilegedAction)
 */

export const CONFIG_AUDIT_CATEGORIES = {
  modules: {
    label: "Modules & entitlements",
    actions: ["entitlement.update", "feature_flag.update", "workspace_page.visibility"],
  },
  security: {
    label: "Security policies",
    actions: [
      "security.settings.update",
      "security.passkey_policy.update",
      "security.ip_allowlist.add",
      "security.ip_allowlist.remove",
      "sso.write",
      "retention.update",
    ],
  },
} as const;

export type ConfigAuditCategory = keyof typeof CONFIG_AUDIT_CATEGORIES;

const ALL_ACTIONS: string[] = [
  ...CONFIG_AUDIT_CATEGORIES.modules.actions,
  ...CONFIG_AUDIT_CATEGORIES.security.actions,
];

function categoryFor(action: string): ConfigAuditCategory | "other" {
  if ((CONFIG_AUDIT_CATEGORIES.modules.actions as readonly string[]).includes(action)) return "modules";
  if ((CONFIG_AUDIT_CATEGORIES.security.actions as readonly string[]).includes(action)) return "security";
  return "other";
}

export const listTenantConfigAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      category: z.enum(["modules", "security", "all"]).default("all"),
      limit: z.number().int().min(1).max(500).default(200),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const actions =
      data.category === "modules" ? [...CONFIG_AUDIT_CATEGORIES.modules.actions] :
      data.category === "security" ? [...CONFIG_AUDIT_CATEGORIES.security.actions] :
      ALL_ACTIONS;

    const { data: rows, error } = await context.supabase
      .from("audit_log")
      .select("id, occurred_at, actor_user_id, actor_email, action, resource_type, resource_id, context")
      .eq("tenant_id", data.tenant_id)
      .in("action", actions)
      .order("occurred_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);

    return (rows ?? []).map((r: any) => ({
      id: String(r.id),
      occurred_at: r.occurred_at as string,
      actor_user_id: (r.actor_user_id as string | null) ?? null,
      actor_email: (r.actor_email as string | null) ?? null,
      action: r.action as string,
      category: categoryFor(r.action as string),
      resource_type: (r.resource_type as string | null) ?? null,
      resource_id: (r.resource_id as string | null) ?? null,
      context: (r.context ?? {}) as Record<string, any>,
    }));
  });
