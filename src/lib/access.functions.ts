/**
 * Access resolution server functions.
 *
 * Single source of truth for "what can this user do in this tenant/BU?".
 * Wraps the `effective_user_permissions` RPC and the platform-admin check so
 * the UI never has to mix multiple sources.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const uuid = z.string().uuid();

export type EffectivePermissionSource = {
  permission_id: string;
  source: string;        // "role" | "group" | "direct"
  role_id: string | null;
  group_id: string | null;
  bu_id: string | null;
};

export type AccessSnapshot = {
  user_id: string;
  tenant_id: string;
  bu_id: string | null;
  is_platform_admin: boolean;
  tenant_role: string | null;          // tenant_members.role
  permission_ids: string[];            // unique, sorted
  sources: EffectivePermissionSource[];
  resolved_at: string;
};

export async function resolveAccess(
  ctx: any,
  userId: string,
  tenantId: string,
  buId: string | null,
): Promise<AccessSnapshot> {
  const [platformResult, memberResult, permissionsResult, catalogueResult] = await Promise.all([
    ctx.supabase.rpc("is_platform_admin", { _user_id: userId }),
    ctx.supabase
      .from("tenant_members")
      .select("role,active")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .maybeSingle(),
    ctx.supabase.rpc("effective_user_permissions", {
      _user_id: userId,
      _tenant_id: tenantId,
      ...(buId ? { _bu_id: buId } : {}),
    } as any),
    ctx.supabase.from("permissions").select("id"),
  ]);
  for (const result of [platformResult, memberResult, permissionsResult, catalogueResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  const isPlat = platformResult.data;
  const member = memberResult.data;
  const rows = permissionsResult.data;
  const perms = catalogueResult.data;

  const platformAdmin = !!isPlat;
  const allPermIds = (perms ?? []).map((p: any) => p.id as string);
  const sources: EffectivePermissionSource[] = (rows ?? []).map((r: any) => ({
    permission_id: r.permission_id,
    source: r.source,
    role_id: r.role_id ?? null,
    group_id: r.group_id ?? null,
    bu_id: r.bu_id ?? null,
  }));

  // Platform admins get implicit grant to every permission within any tenant.
  const idSet = new Set<string>(sources.map((s) => s.permission_id));
  if (platformAdmin) for (const id of allPermIds) idSet.add(id);

  const suspended = member?.active === false;
  return {
    user_id: userId,
    tenant_id: tenantId,
    bu_id: buId,
    is_platform_admin: platformAdmin,
    tenant_role: member?.role ?? (platformAdmin ? "platform_admin" : null),
    permission_ids: suspended ? [] : Array.from(idSet).sort(),
    sources: suspended ? [] : sources,
    resolved_at: new Date().toISOString(),
  };
}

/** Effective access for the calling user. Cheap, called on every page. */
export const getMyAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: uuid, bu_id: uuid.nullish() }).parse(d))
  .handler(async ({ data, context }) =>
    resolveAccess(context, context.userId, data.tenant_id, data.bu_id ?? null));

/** Effective access for a target user; admin-only (used by Access Explorer). */
export const explainUserAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: uuid,
      user_id: uuid,
      bu_id: uuid.nullish(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    // Caller must be platform admin OR tenant_admin of this tenant.
    const [platformResult, callerRoleResult] = await Promise.all([
      context.supabase.rpc("is_platform_admin", { _user_id: context.userId }),
      context.supabase.rpc("has_tenant_role", {
        _user_id: context.userId,
        _tenant_id: data.tenant_id,
        _role: "tenant_admin",
      }),
    ]);
    if (platformResult.error) throw new Error(platformResult.error.message);
    if (callerRoleResult.error) throw new Error(callerRoleResult.error.message);
    const isPlat = platformResult.data;
    const callerRole = callerRoleResult.data;
    if (!isPlat && !callerRole) throw new Error("Forbidden");
    return resolveAccess(context, data.user_id, data.tenant_id, data.bu_id ?? null);
  });

/** Tenant members the caller is allowed to inspect. */
export const listInspectableMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const [platformResult, callerRoleResult] = await Promise.all([
      context.supabase.rpc("is_platform_admin", { _user_id: context.userId }),
      context.supabase.rpc("has_tenant_role", {
        _user_id: context.userId,
        _tenant_id: data.tenant_id,
        _role: "tenant_admin",
      }),
    ]);
    if (platformResult.error) throw new Error(platformResult.error.message);
    if (callerRoleResult.error) throw new Error(callerRoleResult.error.message);
    const isPlat = platformResult.data;
    const callerRole = callerRoleResult.data;
    if (!isPlat && !callerRole) throw new Error("Forbidden");
    const { data: rows, error } = await context.supabase
      .from("tenant_members")
      .select("user_id, role, active, profiles:profiles!inner(email, full_name)")
      .eq("tenant_id", data.tenant_id)
      .order("role");
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      user_id: r.user_id,
      role: r.role,
      active: r.active,
      email: r.profiles?.email ?? null,
      full_name: r.profiles?.full_name ?? null,
    }));
  });

/** Lookup helper for the explorer: roles + groups + business units, all in one. */
export const listAccessLookups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const [roles, groups, bus, perms] = await Promise.all([
      context.supabase
        .from("rbac_roles")
        .select("id,key,name,is_system")
        .or(`tenant_id.is.null,tenant_id.eq.${data.tenant_id}`),
      context.supabase
        .from("tenant_groups")
        .select("id,name,bu_id")
        .eq("tenant_id", data.tenant_id),
      context.supabase
        .from("business_units")
        .select("id,name")
        .eq("tenant_id", data.tenant_id)
        .order("name"),
      context.supabase
        .from("permissions")
        .select("id,resource,action,description,category,is_dangerous,requires_step_up")
        .order("category").order("id"),
    ]);
    if (roles.error) throw new Error(roles.error.message);
    if (groups.error) throw new Error(groups.error.message);
    if (bus.error) throw new Error(bus.error.message);
    if (perms.error) throw new Error(perms.error.message);
    return {
      roles: roles.data ?? [],
      groups: groups.data ?? [],
      business_units: bus.data ?? [],
      permissions: perms.data ?? [],
    };
  });
