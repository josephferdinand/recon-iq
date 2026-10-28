import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/rbac-guards.server";
import { z } from "zod";

async function assertPlatformAdmin(ctx: any) {
  await requirePlatformAdmin(ctx, { fnName: "platform-groups" });
}

const platformRoleEnum = z.enum(["platform_admin","platform_member","platform_super_admin"]);

export const listPlatformGroups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data: groups, error } = await context.supabase
      .from("platform_groups").select("id,name,description,is_system,preset_key,created_at,updated_at").order("is_system", { ascending: false }).order("name");
    if (error) throw new Error(error.message);
    const ids = (groups ?? []).map((g: any) => g.id);
    if (!ids.length) return [];
    const [{ data: roles }, { data: members }] = await Promise.all([
      context.supabase.from("platform_group_roles").select("group_id,role").in("group_id", ids),
      context.supabase.from("platform_group_members").select("group_id,user_id").in("group_id", ids),
    ]);
    const rolesByGroup: Record<string, string[]> = {};
    const memberCount: Record<string, number> = {};
    (roles ?? []).forEach((r: any) => { (rolesByGroup[r.group_id] ??= []).push(r.role); });
    (members ?? []).forEach((m: any) => { memberCount[m.group_id] = (memberCount[m.group_id] ?? 0) + 1; });
    return (groups ?? []).map((g: any) => ({
      ...g, roles: rolesByGroup[g.id] ?? [], member_count: memberCount[g.id] ?? 0,
    }));
  });

export const createPlatformGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    name: z.string().min(2).max(80),
    description: z.string().max(500).optional(),
    roles: z.array(platformRoleEnum).default([]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { data: g, error } = await context.supabase.from("platform_groups")
      .insert({ name: data.name, description: data.description ?? null, created_by: context.userId })
      .select("id").single();
    if (error) throw new Error(error.message);
    if (data.roles.length) {
      const rows = data.roles.map((r) => ({ group_id: g.id, role: r, granted_by: context.userId }));
      await context.supabase.from("platform_group_roles").insert(rows);
    }
    return g;
  });

export const setPlatformGroupRoles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    group_id: z.string().uuid(),
    roles: z.array(platformRoleEnum),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    await context.supabase.from("platform_group_roles").delete().eq("group_id", data.group_id);
    if (data.roles.length) {
      const rows = data.roles.map((r) => ({ group_id: data.group_id, role: r, granted_by: context.userId }));
      const { error } = await context.supabase.from("platform_group_roles").insert(rows);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const listPlatformGroupMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ group_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { data: rows, error } = await context.supabase
      .from("platform_group_members").select("user_id,added_at").eq("group_id", data.group_id);
    if (error) throw new Error(error.message);
    const ids = (rows ?? []).map((r: any) => r.user_id);
    if (!ids.length) return [];
    const { data: profs } = await context.supabase
      .from("profiles").select("id,email,full_name").in("id", ids);
    const map = new Map((profs ?? []).map((p: any) => [p.id, p]));
    return (rows ?? []).map((r: any) => ({
      user_id: r.user_id, added_at: r.added_at,
      email: map.get(r.user_id)?.email ?? null,
      full_name: map.get(r.user_id)?.full_name ?? null,
    }));
  });

export const addPlatformGroupMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    group_id: z.string().uuid(), user_id: z.string().uuid(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { error } = await context.supabase.from("platform_group_members")
      .insert({ group_id: data.group_id, user_id: data.user_id, added_by: context.userId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removePlatformGroupMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    group_id: z.string().uuid(), user_id: z.string().uuid(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { error } = await context.supabase.from("platform_group_members")
      .delete().eq("group_id", data.group_id).eq("user_id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const searchPlatformUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ q: z.string().min(1).max(120) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { data: rows, error } = await context.supabase
      .from("profiles").select("id,email,full_name")
      .or(`email.ilike.%${data.q}%,full_name.ilike.%${data.q}%`)
      .limit(15);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
