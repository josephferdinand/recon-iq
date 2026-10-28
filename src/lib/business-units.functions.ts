import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(ctx: any, tenantId: string) {
  const { data } = await ctx.supabase.rpc("has_tenant_role", {
    _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_admin",
  });
  if (!data) {
    const { data: isPlat } = await ctx.supabase.rpc("is_platform_admin", { _user_id: ctx.userId });
    if (!isPlat) throw new Error("Forbidden: tenant_admin required");
  }
}

async function audit(ctx: any, tenantId: string, action: string, resourceId: string | null, extra: any = {}) {
  await ctx.supabase.from("audit_log").insert({
    actor_user_id: ctx.userId, tenant_id: tenantId, scope: "tenant",
    action, resource_type: "business_units", resource_id: resourceId,
    context: extra,
  } as any);
}

export const listBusinessUnits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) =>
    z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("business_units")
      .select("id, parent_id, name, code, description, depth, is_archived, created_at")
      .eq("tenant_id", data.tenant_id)
      .order("depth")
      .order("name");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const createBusinessUnit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      parent_id: z.string().uuid().nullable().optional(),
      name: z.string().min(1).max(120),
      code: z.string().max(40).optional().nullable(),
      description: z.string().max(500).optional().nullable(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    const { data: row, error } = await context.supabase
      .from("business_units")
      .insert({
        tenant_id: data.tenant_id,
        parent_id: data.parent_id ?? null,
        name: data.name,
        code: data.code ? data.code.toUpperCase() : null,
        description: data.description ?? null,
        created_by: context.userId,
      } as any)
      .select("id").single();
    if (error) throw new Error(error.message);
    await audit(context, data.tenant_id, "bu.create", row.id, { name: data.name, code: data.code });
    return { id: row.id };
  });

export const updateBusinessUnit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      id: z.string().uuid(),
      name: z.string().min(1).max(120).optional(),
      code: z.string().max(40).optional().nullable(),
      description: z.string().max(500).optional().nullable(),
      parent_id: z.string().uuid().nullable().optional(),
      is_archived: z.boolean().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    const patch: any = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.code !== undefined) patch.code = data.code ? data.code.toUpperCase() : null;
    if (data.description !== undefined) patch.description = data.description;
    if (data.parent_id !== undefined) patch.parent_id = data.parent_id;
    if (data.is_archived !== undefined) patch.is_archived = data.is_archived;
    const { error } = await context.supabase
      .from("business_units").update(patch).eq("id", data.id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await audit(context, data.tenant_id, "bu.update", data.id, patch);
    return { ok: true };
  });

export const deleteBusinessUnit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: z.string().uuid(), id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    const { count } = await context.supabase
      .from("business_units").select("id", { count: "exact", head: true })
      .eq("parent_id", data.id);
    if ((count ?? 0) > 0) throw new Error("BU has children — archive it instead");
    const { error } = await context.supabase
      .from("business_units").delete().eq("id", data.id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await audit(context, data.tenant_id, "bu.delete", data.id);
    return { ok: true };
  });

export const listBuMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; bu_id: string }) =>
    z.object({ tenant_id: z.string().uuid(), bu_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const [{ data: users }, { data: groups }] = await Promise.all([
      context.supabase.from("bu_user_assignments")
        .select("id, user_id, role, inherit_descendants, created_at")
        .eq("bu_id", data.bu_id),
      context.supabase.from("bu_group_assignments")
        .select("id, group_id, role, inherit_descendants, created_at, tenant_groups(name)")
        .eq("bu_id", data.bu_id),
    ]);
    return {
      users: users ?? [],
      groups: (groups ?? []).map((g: any) => ({
        id: g.id, group_id: g.group_id, role: g.role,
        inherit_descendants: g.inherit_descendants, created_at: g.created_at,
        name: g.tenant_groups?.name ?? g.group_id.slice(0, 8),
      })),
    };
  });

export const assignBuUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      bu_id: z.string().uuid(),
      user_id: z.string().uuid(),
      role: z.enum(["bu_admin", "bu_member", "bu_viewer"]).default("bu_member"),
      inherit_descendants: z.boolean().default(true),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    const { error } = await context.supabase.from("bu_user_assignments").insert({
      tenant_id: data.tenant_id, bu_id: data.bu_id, user_id: data.user_id,
      role: data.role, inherit_descendants: data.inherit_descendants,
      created_by: context.userId,
    } as any);
    if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    await audit(context, data.tenant_id, "bu.assign_user", data.bu_id, { user_id: data.user_id, role: data.role });
    return { ok: true };
  });

export const removeBuUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: z.string().uuid(), assignment_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    const { error } = await context.supabase
      .from("bu_user_assignments").delete().eq("id", data.assignment_id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const assignBuGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      bu_id: z.string().uuid(),
      group_id: z.string().uuid(),
      role: z.enum(["bu_admin", "bu_member", "bu_viewer"]).default("bu_member"),
      inherit_descendants: z.boolean().default(true),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    const { error } = await context.supabase.from("bu_group_assignments").insert({
      tenant_id: data.tenant_id, bu_id: data.bu_id, group_id: data.group_id,
      role: data.role, inherit_descendants: data.inherit_descendants,
      created_by: context.userId,
    } as any);
    if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    await audit(context, data.tenant_id, "bu.assign_group", data.bu_id, { group_id: data.group_id, role: data.role });
    return { ok: true };
  });

export const removeBuGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: z.string().uuid(), assignment_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    const { error } = await context.supabase
      .from("bu_group_assignments").delete().eq("id", data.assignment_id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listBuResources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; bu_id: string }) =>
    z.object({ tenant_id: z.string().uuid(), bu_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const [recons, sources, pipelines] = await Promise.all([
      context.supabase.from("recon_definitions").select("id, name").eq("tenant_id", data.tenant_id).eq("bu_id", data.bu_id),
      context.supabase.from("workspace_data_sources").select("id, name").eq("tenant_id", data.tenant_id).eq("bu_id", data.bu_id),
      context.supabase.from("data_prep_pipelines").select("id, name").eq("tenant_id", data.tenant_id).eq("bu_id", data.bu_id),
    ]);
    return {
      recons: recons.data ?? [],
      sources: sources.data ?? [],
      pipelines: pipelines.data ?? [],
    };
  });
