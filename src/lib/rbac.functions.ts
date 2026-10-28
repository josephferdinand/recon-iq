import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantAdmin } from "@/lib/rbac-guards.server";
import { z } from "zod";

async function assertTenantAdmin(ctx: any, tenantId: string) {
  await requireTenantAdmin(ctx, tenantId, { fnName: "rbac" });
  return true;
}

async function audit(ctx: any, row: Record<string, unknown>) {
  // Cast as any: audit_log has trigger-managed columns (row_hash) that the
  // generated Insert type marks required. The DB trigger fills them in.
  await ctx.supabase.from("audit_log").insert(row as any);
}

const scopeTypeSchema = z.enum(["tenant", "business_unit", "recon_definition", "data_source"]);

/** Catalog of all permissions (read-only for any authenticated user). */
export const listPermissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("permissions")
      .select("id,resource,action,description,category,is_dangerous,requires_step_up")
      .order("category").order("id");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** System + tenant-specific roles. */
export const listRoles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("rbac_roles")
      .select("id,tenant_id,key,name,description,is_system,is_assignable,cloned_from,created_at")
      .or(`tenant_id.is.null,tenant_id.eq.${data.tenant_id}`)
      .order("is_system", { ascending: false })
      .order("name");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Permissions assigned to a given role. */
export const listRolePermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ role_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("rbac_role_permissions")
      .select("permission_id")
      .eq("role_id", data.role_id);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => r.permission_id as string);
  });

/** Clone a system role into a custom tenant role (clone-and-narrow). */
export const cloneRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    source_role_id: z.string().uuid(),
    name: z.string().min(2).max(80),
    description: z.string().max(500).optional(),
    permission_ids: z.array(z.string()).min(1),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);

    const { data: srcPerms } = await context.supabase
      .from("rbac_role_permissions").select("permission_id").eq("role_id", data.source_role_id);
    const allowed = new Set((srcPerms ?? []).map((r: any) => r.permission_id));
    const invalid = data.permission_ids.filter((p) => !allowed.has(p));
    if (invalid.length) throw new Error(`Permissions not in source role: ${invalid.join(", ")}`);

    const key = `custom_${Date.now().toString(36)}`;
    const { data: role, error } = await context.supabase
      .from("rbac_roles")
      .insert({
        tenant_id: data.tenant_id, key, name: data.name,
        description: data.description ?? null,
        is_system: false, is_assignable: true,
        cloned_from: data.source_role_id, created_by: context.userId,
      })
      .select("id,key,name").single();
    if (error) throw new Error(error.message);

    const rows = data.permission_ids.map((pid) => ({ role_id: role.id, permission_id: pid }));
    const { error: rpErr } = await context.supabase.from("rbac_role_permissions").insert(rows);
    if (rpErr) throw new Error(rpErr.message);

    await audit(context, {
      tenant_id: data.tenant_id, actor_user_id: context.userId,
      action: "rbac.role.clone", scope: "tenant",
      resource_type: "rbac_roles", resource_id: role.id,
      context: { source_role_id: data.source_role_id, name: data.name, perm_count: data.permission_ids.length },
    });
    return role;
  });

/** Grant a role to a user, optionally scoped. */
export const grantRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    user_id: z.string().uuid(),
    role_id: z.string().uuid(),
    scope_type: scopeTypeSchema.default("tenant"),
    scope_id: z.string().uuid().optional(),
    expires_at: z.string().datetime().optional(),
    reason: z.string().max(500).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);

    const payload: any = {
      tenant_id: data.tenant_id, user_id: data.user_id, role_id: data.role_id,
      scope_type: data.scope_type,
      scope_id: data.scope_type === "tenant" ? null : (data.scope_id ?? null),
      granted_by: context.userId,
      expires_at: data.expires_at ?? null,
      reason: data.reason ?? null,
    };
    const { data: grant, error } = await context.supabase
      .from("rbac_user_grants").insert(payload).select("id").single();
    if (error) throw new Error(error.message);

    await audit(context, {
      tenant_id: data.tenant_id, actor_user_id: context.userId,
      action: "rbac.role.grant", scope: "tenant",
      resource_type: "rbac_user_grants", resource_id: grant.id,
      context: payload,
    });
    return grant;
  });

/** Revoke an active grant. */
export const revokeGrant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    grant_id: z.string().uuid(),
    reason: z.string().max(500).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const { error } = await context.supabase
      .from("rbac_user_grants")
      .update({ revoked_at: new Date().toISOString(), revoked_by: context.userId, reason: data.reason ?? null })
      .eq("id", data.grant_id).eq("tenant_id", data.tenant_id).is("revoked_at", null);
    if (error) throw new Error(error.message);
    await audit(context, {
      tenant_id: data.tenant_id, actor_user_id: context.userId,
      action: "rbac.role.revoke", scope: "tenant",
      resource_type: "rbac_user_grants", resource_id: data.grant_id,
      context: { reason: data.reason ?? null },
    });
    return { ok: true };
  });

/** All active grants for a user in a tenant. */
export const listUserGrants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(), user_id: z.string().uuid(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("rbac_user_grants")
      .select("id,role_id,scope_type,scope_id,granted_at,expires_at,granted_by,reason")
      .eq("tenant_id", data.tenant_id).eq("user_id", data.user_id).is("revoked_at", null)
      .order("granted_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Suspend / reactivate a user. */
export const setMemberActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(), user_id: z.string().uuid(),
    active: z.boolean(), reason: z.string().max(500).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const { error } = await context.supabase
      .from("tenant_members")
      .update({ active: data.active, deactivated_at: data.active ? null : new Date().toISOString() })
      .eq("tenant_id", data.tenant_id).eq("user_id", data.user_id);
    if (error) throw new Error(error.message);
    if (!data.active) {
      await context.supabase.from("rbac_session_revocations").insert({
        tenant_id: data.tenant_id, user_id: data.user_id,
        revoked_by: context.userId, reason: data.reason ?? "suspend",
      });
    }
    await audit(context, {
      tenant_id: data.tenant_id, actor_user_id: context.userId,
      action: data.active ? "tenant.user.reactivate" : "tenant.user.suspend",
      scope: "tenant", resource_type: "tenant_members", resource_id: data.user_id,
      context: { reason: data.reason ?? null },
    });
    return { ok: true };
  });

/** SoD rules visible to this tenant (own + platform-wide). */
export const listSodRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("rbac_sod_rules")
      .select("id,tenant_id,name,description,permission_a,permission_b,same_scope_only,severity")
      .or(`tenant_id.is.null,tenant_id.eq.${data.tenant_id}`).order("name");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/* -------- Role lifecycle (custom roles only) -------- */

async function loadRoleOrThrow(ctx: any, roleId: string) {
  const { data, error } = await ctx.supabase
    .from("rbac_roles")
    .select("id,tenant_id,key,name,description,is_system")
    .eq("id", roleId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Role not found");
  return data as { id: string; tenant_id: string | null; key: string; name: string; description: string | null; is_system: boolean };
}

/** Create an empty custom tenant role (no source). */
export const createCustomRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    name: z.string().min(2).max(80),
    description: z.string().max(500).optional(),
    permission_ids: z.array(z.string()).default([]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const key = `custom_${Date.now().toString(36)}`;
    const { data: role, error } = await context.supabase
      .from("rbac_roles")
      .insert({
        tenant_id: data.tenant_id, key, name: data.name,
        description: data.description ?? null,
        is_system: false, is_assignable: true,
        cloned_from: null, created_by: context.userId,
      })
      .select("id,key,name").single();
    if (error) throw new Error(error.message);

    if (data.permission_ids.length) {
      const rows = data.permission_ids.map((pid) => ({ role_id: role.id, permission_id: pid }));
      const { error: rpErr } = await context.supabase.from("rbac_role_permissions").insert(rows);
      if (rpErr) throw new Error(rpErr.message);
    }
    await audit(context, {
      tenant_id: data.tenant_id, actor_user_id: context.userId,
      action: "rbac.role.create", scope: "tenant",
      resource_type: "rbac_roles", resource_id: role.id,
      context: { name: data.name, perm_count: data.permission_ids.length },
    });
    return role;
  });

/** Rename / re-describe a custom role. System roles are read-only. */
export const updateRoleMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    role_id: z.string().uuid(),
    name: z.string().min(2).max(80).optional(),
    description: z.string().max(500).nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await loadRoleOrThrow(context, data.role_id);
    if (role.is_system || !role.tenant_id) throw new Error("Cannot edit a system role; clone it first");
    await assertTenantAdmin(context, role.tenant_id);
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    const { error } = await context.supabase
      .from("rbac_roles").update(patch as any).eq("id", role.id);
    if (error) throw new Error(error.message);
    await audit(context, {
      tenant_id: role.tenant_id, actor_user_id: context.userId,
      action: "rbac.role.update", scope: "tenant",
      resource_type: "rbac_roles", resource_id: role.id,
      context: { before: { name: role.name, description: role.description }, after: patch },
    });
    return { ok: true };
  });

/** Replace the permission set of a custom role. */
export const updateRolePermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    role_id: z.string().uuid(),
    permission_ids: z.array(z.string()),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await loadRoleOrThrow(context, data.role_id);
    if (role.is_system || !role.tenant_id) throw new Error("Cannot edit a system role; clone it first");
    await assertTenantAdmin(context, role.tenant_id);

    const desired = new Set(data.permission_ids);
    const { data: current } = await context.supabase
      .from("rbac_role_permissions").select("permission_id").eq("role_id", role.id);
    const existing = new Set((current ?? []).map((r: any) => r.permission_id as string));

    const toAdd = [...desired].filter((p) => !existing.has(p));
    const toRemove = [...existing].filter((p) => !desired.has(p));

    if (toRemove.length) {
      const { error } = await context.supabase
        .from("rbac_role_permissions").delete()
        .eq("role_id", role.id).in("permission_id", toRemove);
      if (error) throw new Error(error.message);
    }
    if (toAdd.length) {
      const rows = toAdd.map((pid) => ({ role_id: role.id, permission_id: pid }));
      const { error } = await context.supabase.from("rbac_role_permissions").insert(rows);
      if (error) throw new Error(error.message);
    }
    await audit(context, {
      tenant_id: role.tenant_id, actor_user_id: context.userId,
      action: "rbac.role.permissions.updated", scope: "tenant",
      resource_type: "rbac_roles", resource_id: role.id,
      context: { added: toAdd, removed: toRemove, total: desired.size },
    });
    return { ok: true, added: toAdd.length, removed: toRemove.length };
  });

/** Delete a custom role (and its permission mappings via cascade). */
export const deleteCustomRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ role_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await loadRoleOrThrow(context, data.role_id);
    if (role.is_system || !role.tenant_id) throw new Error("Cannot delete a system role");
    await assertTenantAdmin(context, role.tenant_id);
    const { error } = await context.supabase.from("rbac_roles").delete().eq("id", role.id);
    if (error) throw new Error(error.message);
    await audit(context, {
      tenant_id: role.tenant_id, actor_user_id: context.userId,
      action: "rbac.role.delete", scope: "tenant",
      resource_type: "rbac_roles", resource_id: role.id,
      context: { name: role.name, key: role.key },
    });
    return { ok: true };
  });
