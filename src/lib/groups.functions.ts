import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Tenant Groups — world-class RBAC inheritance layer.
 *
 * Hierarchy supported: Tenant → (optional Business Unit) → Group → User.
 * A group bundles one or more roles from `rbac_roles`. Members of the group
 * inherit every permission of every assigned role. Groups can be tenant-wide
 * or scoped to a Business Unit. System "preset" groups (Administrators,
 * Operations, Read Only, Compliance, Data Engineering, Security Admins,
 * Support Desk, AI Stewards, Investigators) are auto-seeded for every tenant
 * via `seed_default_tenant_groups()` and may be edited but not deleted.
 */

async function assertAdmin(ctx: any, tenantId: string) {
  const { data: isPlat } = await ctx.supabase.rpc("is_platform_admin", { _user_id: ctx.userId });
  if (isPlat) return;
  const { data } = await ctx.supabase.rpc("has_tenant_role", {
    _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_admin",
  });
  if (!data) throw new Error("Forbidden: tenant_admin required");
}

async function audit(ctx: any, row: Record<string, unknown>) {
  await ctx.supabase.from("audit_log").insert(row as any);
}

const uuid = z.string().uuid();

/* --------------------------------- READ --------------------------------- */

/** All groups in a tenant, with role + member counts. */
export const listGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: uuid, bu_id: uuid.optional() }).parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("tenant_groups")
      .select(
        "id, name, description, created_at, is_system, preset_key, bu_id, " +
        "tenant_group_members(user_id), tenant_group_roles(role_id)",
      )
      .eq("tenant_id", data.tenant_id)
      .order("is_system", { ascending: false })
      .order("name");
    if (data.bu_id) q = q.eq("bu_id", data.bu_id);
    const { data: groups, error } = await q;
    if (error) throw new Error(error.message);
    return (groups ?? []).map((g: any) => ({
      id: g.id, name: g.name, description: g.description, created_at: g.created_at,
      is_system: g.is_system, preset_key: g.preset_key, bu_id: g.bu_id,
      member_count: g.tenant_group_members?.length ?? 0,
      role_ids: (g.tenant_group_roles ?? []).map((r: any) => r.role_id),
      member_ids: (g.tenant_group_members ?? []).map((r: any) => r.user_id),
    }));
  });

/** Catalog of preset templates (plug-and-play). */
export const listGroupPresets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("tenant_group_presets")
      .select("preset_key,name,description,role_keys,sort_order")
      .order("sort_order");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Re-seed/refresh preset groups for a tenant (idempotent). */
export const reseedPresetGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    const { data: count, error } = await context.supabase
      .rpc("seed_default_tenant_groups", { _tenant_id: data.tenant_id });
    if (error) throw new Error(error.message);
    await audit(context, {
      tenant_id: data.tenant_id, actor_user_id: context.userId, scope: "tenant",
      action: "group.preset.reseed", resource_type: "tenant_groups", context: { count },
    });
    return { count };
  });

/** Effective permissions for a user, optionally scoped to a Business Unit. */
export const effectivePermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: uuid, user_id: uuid, bu_id: uuid.optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .rpc("effective_user_permissions", {
        _user_id: data.user_id,
        _tenant_id: data.tenant_id,
        ...(data.bu_id ? { _bu_id: data.bu_id } : {}),
      } as any);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/* --------------------------------- WRITE -------------------------------- */

export const createGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: uuid,
      name: z.string().min(1).max(80),
      description: z.string().max(500).nullish(),
      bu_id: uuid.nullish(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    const { data: row, error } = await context.supabase.from("tenant_groups")
      .insert({
        tenant_id: data.tenant_id,
        name: data.name,
        description: data.description ?? null,
        bu_id: data.bu_id ?? null,
        created_by: context.userId,
      } as any)
      .select("id").single();
    if (error) throw new Error(error.message);
    await audit(context, {
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "group.create", resource_type: "tenant_groups", resource_id: row.id,
      context: { name: data.name, bu_id: data.bu_id ?? null },
    });
    return { id: row.id };
  });

export const updateGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: uuid, group_id: uuid,
      name: z.string().min(1).max(80).optional(),
      description: z.string().max(500).optional(),
      bu_id: uuid.nullable().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    if (data.bu_id !== undefined) patch.bu_id = data.bu_id;
    const { error } = await context.supabase.from("tenant_groups")
      .update(patch as any).eq("id", data.group_id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: uuid, group_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    const { data: row } = await context.supabase
      .from("tenant_groups").select("is_system")
      .eq("id", data.group_id).eq("tenant_id", data.tenant_id).single();
    if (row?.is_system) throw new Error("System preset groups cannot be deleted; remove members instead.");
    const { error } = await context.supabase.from("tenant_groups")
      .delete().eq("id", data.group_id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await audit(context, {
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "group.delete", resource_type: "tenant_groups", resource_id: data.group_id,
    });
    return { ok: true };
  });

/** Replace the full set of roles assigned to a group. */
export const setGroupRoles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: uuid,
      group_id: uuid,
      role_ids: z.array(uuid).max(50),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    await context.supabase.from("tenant_group_roles").delete().eq("group_id", data.group_id);
    if (data.role_ids.length) {
      const rows = data.role_ids.map((rid) => ({
        group_id: data.group_id, role_id: rid, granted_by: context.userId,
      }));
      const { error } = await context.supabase.from("tenant_group_roles").insert(rows as any);
      if (error) throw new Error(error.message);
    }
    await audit(context, {
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "group.roles.set", resource_type: "tenant_groups", resource_id: data.group_id,
      context: { role_ids: data.role_ids },
    });
    return { ok: true };
  });

export const addGroupMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: uuid, group_id: uuid, user_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    const { error } = await context.supabase.from("tenant_group_members")
      .insert({ group_id: data.group_id, user_id: data.user_id, added_by: context.userId } as any);
    if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    await audit(context, {
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "group.member.add", resource_type: "tenant_group_members",
      resource_id: data.group_id, context: { user_id: data.user_id },
    });
    return { ok: true };
  });

export const removeGroupMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: uuid, group_id: uuid, user_id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    const { error } = await context.supabase.from("tenant_group_members")
      .delete().eq("group_id", data.group_id).eq("user_id", data.user_id);
    if (error) throw new Error(error.message);
    await audit(context, {
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "group.member.remove", resource_type: "tenant_group_members",
      resource_id: data.group_id, context: { user_id: data.user_id },
    });
    return { ok: true };
  });
