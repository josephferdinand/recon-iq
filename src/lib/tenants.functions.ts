// LL-061 (Pri1): The previous lazy-wrapper pattern `function createFamily(...args) {
//   return createServerFn({...}).handler(createFamilyHandler)(...args);
// }` did NOT register the server-fn in the TanStack Start manifest. The
// manifest scanner (TanStack Start's babel/vite plugin) only recognizes
// `export const x = createServerFn(...).handler(handlerRef)` declarations at
// module top-level. The lazy wrapper was added in LL-040 to break a cyclic
// TDZ; that TDZ has since been independently fixed by LL-045 (lazy
// `requireSupabaseAuth()` accessor). So we can safely collapse the handlers
// back into this file as inline `const` declarations. The handlers module
// (`tenants.functions.handlers.ts`) is kept as a thin re-export shim so
// anything else importing from it still works.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mergeTenantsForUser } from "./tenants.functions.helpers";

type HandlerCtx = { context: { supabase: any; userId: string }; data?: any };

export { mergeTenantsForUser };

// --- handler bodies (inlined so the static `createServerFn(...).handler(...)` declaration is visible to the TanStack Start manifest scanner) ---

export async function listMyTenantsHandler({ context }: HandlerCtx) {
  const { data, error } = await context.supabase
    .from("tenant_members")
    .select("role, tenant:tenants(id, slug, name, environment, ai_enabled, family_id)")
    .eq("user_id", context.userId);
  if (error) throw new Error(error.message);
  const memberships = data ?? [];

  const { data: isAdmin, error: adminErr } = await context.supabase.rpc("is_platform_admin", {
    _user_id: context.userId,
  });
  if (adminErr) throw new Error(adminErr.message);
  const { data: platformRoleRows, error: roleErr } = await context.supabase
    .from("platform_roles")
    .select("role")
    .eq("user_id", context.userId);
  if (roleErr) throw new Error(roleErr.message);
  const isMember = (platformRoleRows ?? []).some((r: any) => r.role === "platform_member");
  if (!isAdmin && !isMember) {
    return mergeTenantsForUser({
      memberships,
      isPlatformAdmin: false,
      isPlatformMember: false,
      allTenants: [],
    });
  }
  const { data: all, error: allErr } = await context.supabase
    .from("tenants")
    .select("id, slug, name, environment, ai_enabled, family_id")
    .order("name");
  if (allErr) throw new Error(allErr.message);
  return mergeTenantsForUser({
    memberships,
    isPlatformAdmin: !!isAdmin,
    isPlatformMember: isMember,
    allTenants: all ?? [],
  });
}

export async function getMyAccessHandler({ context }: HandlerCtx) {
  const { data: isAdmin, error: adminErr } = await context.supabase.rpc("is_platform_admin", {
    _user_id: context.userId,
  });
  if (adminErr) throw new Error(adminErr.message);
  const { data: roles, error: roleErr } = await context.supabase
    .from("platform_roles")
    .select("role")
    .eq("user_id", context.userId);
  if (roleErr) throw new Error(roleErr.message);
  const isMember = (roles ?? []).some((r: any) => r.role === "platform_member");
  return {
    is_platform_admin: !!isAdmin,
    is_platform_member: isMember,
    is_platform_staff: !!isAdmin || isMember,
    user_id: context.userId,
  };
}

export async function listAllTenantsHandler({ context }: HandlerCtx) {
  const { data: isAdmin, error: adminErr } = await context.supabase.rpc("is_platform_admin", {
    _user_id: context.userId,
  });
  if (adminErr) throw new Error(adminErr.message);
  if (!isAdmin) throw new Error("Forbidden");
  const { data, error } = await context.supabase
    .from("tenants")
    .select("id, slug, name, environment, ai_enabled, family_id, custom_domain, created_at, family:tenant_families(name)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listFamiliesHandler({ context }: HandlerCtx) {
  const { data: isAdmin } = await context.supabase.rpc("is_platform_admin", {
    _user_id: context.userId,
  });
  if (!isAdmin) throw new Error("Forbidden");
  const { data, error } = await context.supabase
    .from("tenant_families")
    .select("id, name, allow_skip_uat, created_at, tenants(id, slug, environment, ai_enabled)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createFamilyHandler({ data, context }: HandlerCtx) {
  const { data: isAdmin } = await context.supabase.rpc("is_platform_admin", {
    _user_id: context.userId,
  });
  if (!isAdmin) throw new Error("Forbidden");
  const { data: row, error } = await context.supabase
    .from("tenant_families")
    .insert({ name: data.name, created_by: context.userId })
    .select("id, name")
    .single();
  if (error) throw new Error(error.message);
  await context.supabase.from("audit_log").insert({
    actor_user_id: context.userId,
    scope: "platform",
    action: "family.create",
    resource_type: "tenant_family",
    resource_id: row.id,
    context: { name: row.name },
  } as any);
  return row;
}

export async function createTenantHandler({ data, context }: HandlerCtx) {
  const { data: isAdmin } = await context.supabase.rpc("is_platform_admin", {
    _user_id: context.userId,
  });
  if (!isAdmin) throw new Error("Forbidden");

  const { data: tenantId, error: creationError } = await context.supabase
    .rpc("create_tenant_with_email_domain", {
      _family_id: data.family_id,
      _slug: data.slug,
      _name: data.name,
      _environment: data.environment,
      _ai_enabled: data.ai_enabled,
      _email_domain: data.email_domain,
    });
  if (creationError || !tenantId) throw new Error("Unable to create tenant. Check that its slug and email domain are available.");

  const { data: row, error } = await context.supabase
    .from("tenants")
    .select("id, slug, name, environment, ai_enabled, family_id")
    .eq("id", tenantId)
    .single();
  if (error) throw new Error(error.message);

  const { data: creatorMember, error: creatorReadError } = await context.supabase
    .from("tenant_members")
    .select("id,active,role")
    .eq("tenant_id", row.id).eq("user_id", context.userId).maybeSingle();
  if (creatorReadError || !creatorMember || !creatorMember.active || creatorMember.role !== "tenant_admin") {
    throw new Error("Tenant was created, but administrator access could not be verified. Contact platform support.");
  }

  const excluded = (data.excluded_user_ids ?? []).filter((u: string) => u !== context.userId);
  let excluded_count = 0;
  if (excluded.length > 0) {
    const { data: removed, error: delErr } = await context.supabase
      .from("tenant_members")
      .delete()
      .eq("tenant_id", row.id)
      .eq("added_by_platform", true)
      .in("user_id", excluded)
      .select("user_id");
    if (delErr) throw new Error(delErr.message);
    excluded_count = removed?.length ?? 0;
  }

  await context.supabase.from("audit_log").insert({
    actor_user_id: context.userId,
    tenant_id: row.id,
    tenant_slug: row.slug,
    scope: "platform",
    action: "tenant.create",
    resource_type: "tenant",
    resource_id: row.id,
    context: {
      slug: row.slug,
      environment: row.environment,
      ai_enabled: row.ai_enabled,
      seed_excluded_user_ids: excluded,
      seed_excluded_count: excluded_count,
    },
  } as any);
  return { ...row, seed_excluded_count: excluded_count, email_domain_status: "pending" as const };
}

export async function listSeedablePlatformPrincipalsHandler({ context }: HandlerCtx) {
  const { data: isAdmin } = await context.supabase.rpc("is_platform_admin", {
    _user_id: context.userId,
  });
  if (!isAdmin) throw new Error("Forbidden");

  const { data: direct, error: dErr } = await context.supabase
    .from("platform_roles")
    .select("user_id")
    .eq("role", "platform_admin");
  if (dErr) throw new Error(dErr.message);

  const { data: adminGroupRoles, error: gErr } = await context.supabase
    .from("platform_group_roles")
    .select("group_id, group:platform_groups(id, name, description)")
    .eq("role", "platform_admin");
  if (gErr) throw new Error(gErr.message);

  const adminGroupIds = (adminGroupRoles ?? []).map((r: any) => r.group_id);
  const groupsById = new Map<string, { id: string; name: string; description: string | null }>();
  for (const r of adminGroupRoles ?? []) {
    if ((r as any).group) groupsById.set((r as any).group.id, (r as any).group);
  }

  let groupMembers: Array<{ group_id: string; user_id: string }> = [];
  if (adminGroupIds.length > 0) {
    const { data: gm, error: gmErr } = await context.supabase
      .from("platform_group_members")
      .select("group_id, user_id")
      .in("group_id", adminGroupIds);
    if (gmErr) throw new Error(gmErr.message);
    groupMembers = gm ?? [];
  }

  const sources = new Map<string, { direct: boolean; group_ids: Set<string> }>();
  for (const r of direct ?? []) {
    sources.set(r.user_id, { direct: true, group_ids: new Set() });
  }
  for (const m of groupMembers) {
    const e = sources.get(m.user_id) ?? { direct: false, group_ids: new Set() };
    e.group_ids.add(m.group_id);
    sources.set(m.user_id, e);
  }

  const userIds = Array.from(sources.keys());
  const profilesByUserId = new Map<string, { email: string; full_name: string | null }>();
  if (userIds.length > 0) {
    const { data: profs } = await context.supabase
      .from("profiles")
      .select("id, email, full_name")
      .in("id", userIds);
    for (const p of profs ?? []) {
      profilesByUserId.set(p.id, { email: p.email, full_name: p.full_name });
    }
  }

  const admins = userIds
    .map((uid) => {
      const src = sources.get(uid)!;
      const prof = profilesByUserId.get(uid);
      return {
        user_id: uid,
        email: prof?.email ?? null,
        full_name: prof?.full_name ?? null,
        is_direct: src.direct,
        is_creator: uid === context.userId,
        via_group_ids: Array.from(src.group_ids),
        via_group_names: Array.from(src.group_ids)
          .map((gid) => groupsById.get(gid)?.name)
          .filter(Boolean) as string[],
      };
    })
    .sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));

  const groups = Array.from(groupsById.values()).map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    member_count: groupMembers.filter((m) => m.group_id === g.id).length,
  }));

  return { admins, groups, current_user_id: context.userId };
}

export async function setTenantAiHandler({ data, context }: HandlerCtx) {
  const { data: isAdmin } = await context.supabase.rpc("is_platform_admin", {
    _user_id: context.userId,
  });
  const { data: isTenantAdmin } = await context.supabase.rpc("has_tenant_role", {
    _user_id: context.userId,
    _tenant_id: data.tenant_id,
    _role: "tenant_admin",
  });
  if (!isAdmin && !isTenantAdmin) throw new Error("Forbidden");

  const { error } = await context.supabase
    .from("tenants")
    .update({ ai_enabled: data.ai_enabled })
    .eq("id", data.tenant_id);
  if (error) throw new Error(error.message);

  await context.supabase.from("audit_log").insert({
    actor_user_id: context.userId,
    tenant_id: data.tenant_id,
    scope: "tenant",
    action: data.ai_enabled ? "tenant.ai_enable" : "tenant.ai_disable",
    resource_type: "tenant",
    resource_id: data.tenant_id,
    context: { ai_enabled: data.ai_enabled },
  } as any);
  return { ok: true };
}

export async function getTenantBySlugHandler({ data, context }: HandlerCtx) {
  const { data: row, error } = await context.supabase
    .from("tenants")
    .select("id, slug, name, environment, ai_enabled, family_id, custom_domain, region, residency_locked")
    .eq("slug", data.slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("Tenant not found");

  const { data: member, error: memberError } = await context.supabase
    .from("tenant_members")
    .select("role")
    .eq("tenant_id", row.id)
    .eq("user_id", context.userId)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  const { data: isAdmin, error: adminError } = await context.supabase.rpc("is_platform_admin", {
    _user_id: context.userId,
  });
  if (adminError) throw new Error(adminError.message);
  let effectiveRole: string | null = member?.role ?? null;
  if (!member) {
    const { data: roles, error: rolesError } = await context.supabase
      .from("platform_roles").select("role").eq("user_id", context.userId);
    if (rolesError) throw new Error(rolesError.message);
    const isPlatformMember = (roles ?? []).some((r: any) => r.role === "platform_member");
    if (!isAdmin && !isPlatformMember) throw new Error("Forbidden");
    effectiveRole = isAdmin ? "platform_admin" : "platform_member";
    const { error: auditError } = await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: row.id,
      tenant_slug: row.slug,
      scope: "platform",
      action: "tenant.visibility",
      resource_type: "tenant",
      resource_id: row.id,
      context: { via_role: effectiveRole, slug: row.slug },
    } as any);
    if (auditError) throw new Error(auditError.message);
  } else if (isAdmin) {
    effectiveRole = "platform_admin";
  }
  return { ...row, role: effectiveRole };
}

export async function listRecentAuditHandler({ data, context }: HandlerCtx) {
  if (!data.tenant_id) {
    const { data: isPlat } = await context.supabase.rpc("is_platform_admin", { _user_id: context.userId });
    if (!isPlat) throw new Error("Forbidden: tenant_id required for non-platform admins");
  }
  let q = context.supabase
    .from("audit_log")
    .select("id, occurred_at, actor_email, scope, action, tenant_slug, resource_type, resource_id, context")
    .order("occurred_at", { ascending: false })
    .limit(data.limit);
  if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);
  return rows ?? [];
}

// --- server-fn registrations (LL-061: must be `export const x = createServerFn(...).handler(...)` so the manifest scanner picks them up) ---

export const listMyTenants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(listMyTenantsHandler);

export const getMyAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(getMyAccessHandler);

export const listAllTenants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(listAllTenantsHandler);

export const listFamilies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(listFamiliesHandler);

export const createFamily = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d) => z.object({ name: z.string().min(2).max(80) }).parse(d))
  .handler(createFamilyHandler);

export const createTenant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d) =>
    z.object({
      family_id: z.string().uuid(),
      slug: z.string().min(3).max(40).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
      name: z.string().min(2).max(80),
      email_domain: z.string().trim().toLowerCase().max(253).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/),
      environment: z.enum(["dev", "uat", "prod"]),
      ai_enabled: z.boolean().default(false),
      excluded_user_ids: z.array(z.string().uuid()).default([]),
    }).parse(d),
  )
  .handler(createTenantHandler);

export const listSeedablePlatformPrincipals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(listSeedablePlatformPrincipalsHandler);

export const setTenantAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d) => z.object({ tenant_id: z.string().uuid(), ai_enabled: z.boolean() }).parse(d))
  .handler(setTenantAiHandler);

export const getTenantBySlug = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d) => z.object({ slug: z.string() }).parse(d))
  .handler(getTenantBySlugHandler);

export const listRecentAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d) =>
    z.object({
      tenant_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }).parse(d ?? {}),
  )
  .handler(listRecentAuditHandler);
