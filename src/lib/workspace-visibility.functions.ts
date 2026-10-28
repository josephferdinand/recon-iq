import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { WORKSPACE_PAGES } from "@/lib/page-permissions";

/**
 * Tenant-scoped workspace page visibility.
 * Row absent = page enabled. Row with enabled=false hides page from workspace nav
 * and blocks direct URL access.
 */

export const listWorkspacePageVisibility = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) =>
    z.object({ tenant_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tenant_workspace_page_visibility" as any)
      .select("page_key, enabled, updated_at, updated_by")
      .eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    const byKey = new Map<string, any>((rows ?? []).map((r: any) => [r.page_key, r]));
    return WORKSPACE_PAGES.map((p) => ({
      key: p.key,
      label: p.label,
      group: p.group ?? "",
      enabled: byKey.has(p.key) ? !!byKey.get(p.key).enabled : true,
      overridden: byKey.has(p.key),
      updated_at: byKey.get(p.key)?.updated_at ?? null,
    }));
  });

export const setWorkspacePageVisibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      page_key: z.string().min(1).max(64),
      enabled: z.boolean(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const valid = WORKSPACE_PAGES.some((p) => p.key === data.page_key);
    if (!valid) throw new Error("Unknown workspace page");

    const [{ data: isPlatform }, { data: isTenantAdmin }] = await Promise.all([
      context.supabase.rpc("is_platform_admin", { _user_id: context.userId }),
      context.supabase.rpc("has_tenant_role", {
        _user_id: context.userId,
        _tenant_id: data.tenant_id,
        _role: "tenant_admin",
      }),
    ]);
    if (!isPlatform && !isTenantAdmin) throw new Error("Forbidden: tenant_admin or platform_admin required");

    const { error } = await context.supabase
      .from("tenant_workspace_page_visibility" as any)
      .upsert(
        {
          tenant_id: data.tenant_id,
          page_key: data.page_key,
          enabled: data.enabled,
          updated_by: context.userId,
          updated_at: new Date().toISOString(),
        } as any,
        { onConflict: "tenant_id,page_key" },
      );
    if (error) throw new Error(error.message);

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: "workspace_page.visibility",
      resource_type: "tenant_workspace_page_visibility",
      resource_id: data.page_key,
      context: { page_key: data.page_key, enabled: data.enabled },
    } as any);
    return { ok: true as const };
  });

export const listWorkspacePageVisibilityAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      limit: z.number().int().min(1).max(200).optional().default(50),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("audit_log")
      .select("id, occurred_at, actor_user_id, actor_email, action, resource_id, context")
      .eq("tenant_id", data.tenant_id)
      .eq("action", "workspace_page.visibility")
      .order("occurred_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);

    const labelByKey = new Map(WORKSPACE_PAGES.map((p) => [p.key, p.label]));
    return (rows ?? []).map((r: any) => {
      const ctx = (r.context ?? {}) as { page_key?: string; enabled?: boolean };
      const key = ctx.page_key ?? r.resource_id ?? "";
      return {
        id: String(r.id),
        occurred_at: r.occurred_at as string,
        actor_email: (r.actor_email as string | null) ?? null,
        actor_user_id: (r.actor_user_id as string | null) ?? null,
        page_key: key,
        page_label: labelByKey.get(key) ?? key,
        enabled: !!ctx.enabled,
      };
    });
  });
