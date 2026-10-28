import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CatalogEntry = {
  key: string;
  parent_key: string | null;
  name: string;
  description: string | null;
  entry_type: string;
  category: string;
  default_enabled: boolean;
  min_plan: string | null;
  requires: string[];
  tags: string[];
  sort_order: number;
  is_active: boolean;
};

export type ScopeGrant = {
  id: string;
  tenant_id: string;
  catalog_key: string;
  scope_type: "tenant" | "workspace" | "group" | "user";
  scope_id: string | null;
  enabled: boolean;
  reason: string | null;
  updated_by: string | null;
  updated_at: string;
};

/** Public: read the catalog (no auth needed — it's a public registry) */
export const listEntitlementCatalog = createServerFn({ method: "GET" }).handler(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  const supa = createClient(process.env.SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
  const { data, error } = await supa
    .from("entitlement_catalog")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("key", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CatalogEntry[];
});

/** Platform-level: allow/deny a feature for a tenant (writes tenant_feature_entitlements) */
export const setPlatformGrant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId: string; catalogKey: string; allowed: boolean; reason?: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_platform_admin", { _user_id: context.userId });
    if (!isAdmin) throw new Error("Forbidden");
    const { error } = await context.supabase
      .from("tenant_feature_entitlements")
      .upsert(
        { tenant_id: data.tenantId, feature_key: data.catalogKey, allowed: data.allowed, granted_by: context.userId },
        { onConflict: "tenant_id,feature_key" },
      );
    if (error) throw new Error(error.message);
    await context.supabase.from("entitlement_audit_log").insert({
      tenant_id: data.tenantId,
      catalog_key: data.catalogKey,
      scope_type: "platform",
      action: data.allowed ? "grant" : "revoke",
      new_enabled: data.allowed,
      actor_id: context.userId,
      reason: data.reason ?? null,
    });
    return { ok: true };
  });

/** Bulk platform grant */
export const bulkSetPlatformGrants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId: string; catalogKeys: string[]; allowed: boolean }) => d)
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_platform_admin", { _user_id: context.userId });
    if (!isAdmin) throw new Error("Forbidden");
    const rows = data.catalogKeys.map((k) => ({
      tenant_id: data.tenantId,
      feature_key: k,
      allowed: data.allowed,
      granted_by: context.userId,
    }));
    const { error } = await context.supabase
      .from("tenant_feature_entitlements")
      .upsert(rows, { onConflict: "tenant_id,feature_key" });
    if (error) throw new Error(error.message);
    const auditRows = data.catalogKeys.map((k) => ({
      tenant_id: data.tenantId,
      catalog_key: k,
      scope_type: "platform",
      action: data.allowed ? "grant" : "revoke",
      new_enabled: data.allowed,
      actor_id: context.userId,
    }));
    await context.supabase.from("entitlement_audit_log").insert(auditRows);
    return { ok: true, count: rows.length };
  });

/** Read all platform grants for a tenant */
export const listPlatformGrants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tenant_feature_entitlements")
      .select("feature_key, allowed, plan_required, locked_reason, updated_at")
      .eq("tenant_id", data.tenantId);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Tenant-level: set a scope grant (tenant/workspace/group/user) */
export const setScopeGrant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator(
    (d: {
      tenantId: string;
      catalogKey: string;
      scopeType: "tenant" | "workspace" | "group" | "user";
      scopeId?: string | null;
      enabled: boolean;
      reason?: string;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("entitlement_scope_grants")
      .upsert(
        {
          tenant_id: data.tenantId,
          catalog_key: data.catalogKey,
          scope_type: data.scopeType,
          scope_id: data.scopeId ?? null,
          enabled: data.enabled,
          reason: data.reason ?? null,
          updated_by: context.userId,
        },
        { onConflict: "tenant_id,catalog_key,scope_type,scope_id" },
      );
    if (error) throw new Error(error.message);
    await context.supabase.from("entitlement_audit_log").insert({
      tenant_id: data.tenantId,
      catalog_key: data.catalogKey,
      scope_type: data.scopeType,
      scope_id: data.scopeId ?? null,
      action: data.enabled ? "enable" : "disable",
      new_enabled: data.enabled,
      actor_id: context.userId,
      reason: data.reason ?? null,
    });
    return { ok: true };
  });

/** Read all scope grants for a tenant */
export const listScopeGrants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId: string; scopeType?: string; scopeId?: string }) => d)
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("entitlement_scope_grants").select("*").eq("tenant_id", data.tenantId);
    if (data.scopeType) q = q.eq("scope_type", data.scopeType);
    if (data.scopeId) q = q.eq("scope_id", data.scopeId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as ScopeGrant[];
  });

/** Audit history */
export const listEntitlementAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId?: string; catalogKey?: string; limit?: number }) => d)
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("entitlement_audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 200);
    if (data.tenantId) q = q.eq("tenant_id", data.tenantId);
    if (data.catalogKey) q = q.eq("catalog_key", data.catalogKey);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Resolve for a specific user / workspace (uses SECURITY DEFINER fn) */
export const resolveEntitlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId: string; catalogKey: string; workspaceId?: string; userId?: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: allowed, error } = await context.supabase.rpc("resolve_entitlement", {
      _tenant_id: data.tenantId,
      _catalog_key: data.catalogKey,
      _user_id: data.userId ?? context.userId,
      _workspace_id: data.workspaceId ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { allowed: !!allowed };
  });

/** List workspaces / groups / members for a tenant (helpers for scope selectors) */
export const listTenantScopeTargets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId: string }) => d)
  .handler(async ({ data, context }) => {
    const [ws, groups, members] = await Promise.all([
      context.supabase.from("workspaces").select("id, name").eq("tenant_id", data.tenantId).order("name"),
      context.supabase.from("tenant_groups").select("id, name").eq("tenant_id", data.tenantId).order("name"),
      context.supabase.from("tenant_members").select("user_id, role").eq("tenant_id", data.tenantId).limit(500),
    ]);
    const memberRows = (members.data ?? []) as Array<{ user_id: string; role: string }>;
    const userIds = memberRows.map((m) => m.user_id);
    const { data: profiles } = userIds.length
      ? await context.supabase.from("profiles").select("id, email, full_name").in("id", userIds)
      : { data: [] as Array<{ id: string; email: string | null; full_name: string | null }> };
    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
    return {
      workspaces: (ws.data ?? []) as Array<{ id: string; name: string }>,
      groups: (groups.data ?? []) as Array<{ id: string; name: string }>,
      members: memberRows.map((m) => ({
        user_id: m.user_id,
        role: m.role,
        profile: byId.get(m.user_id) ?? null,
      })),
    };
  });
