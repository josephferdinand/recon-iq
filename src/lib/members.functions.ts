import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantAdmin } from "@/lib/rbac-guards.server";
import { z } from "zod";

async function assertTenantAdmin(ctx: any, tenantId: string) {
  await requireTenantAdmin(ctx, tenantId, { fnName: "members" });
  return true;
}

export const listTenantMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isMem } = await context.supabase.rpc("is_tenant_member", {
      _user_id: context.userId, _tenant_id: data.tenant_id,
    });
    const { data: isAdmin } = await context.supabase.rpc("is_platform_admin", { _user_id: context.userId });
    if (!isMem && !isAdmin) throw new Error("Forbidden");

    const { data: rows, error } = await context.supabase
      .from("tenant_members")
      .select("id, user_id, role, joined_at")
      .eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((r) => r.user_id);
    let profiles: any[] = [];
    if (ids.length) {
      const { data: p } = await context.supabase
        .from("profiles").select("id, email, full_name").in("id", ids);
      profiles = p ?? [];
    }
    const map = new Map(profiles.map((p) => [p.id, p]));
    return (rows ?? []).map((r) => ({ ...r, profile: map.get(r.user_id) ?? null }));
  });

export const assignableForInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const [{ data: roles }, { data: groups }, { data: bus }] = await Promise.all([
      context.supabase
        .from("rbac_roles")
        .select("id,key,name,is_system,tenant_id")
        .or(`tenant_id.is.null,tenant_id.eq.${data.tenant_id}`)
        .order("is_system", { ascending: false })
        .order("name"),
      context.supabase
        .from("tenant_groups")
        .select("id,name,is_system,preset_key,bu_id")
        .eq("tenant_id", data.tenant_id)
        .order("is_system", { ascending: false })
        .order("name"),
      context.supabase
        .from("business_units")
        .select("id,name,path::text")
        .eq("tenant_id", data.tenant_id)
        .order("path"),
    ]);
    return {
      roles: (roles ?? []) as Array<{ id: string; key: string; name: string; is_system: boolean; tenant_id: string | null }>,
      groups: (groups ?? []) as Array<{ id: string; name: string; is_system: boolean; preset_key: string | null; bu_id: string | null }>,
      business_units: ((bus ?? []) as any[]).map((b) => ({ id: b.id as string, name: b.name as string, path: String(b.path ?? "") })),
    };
  });

export const inviteMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      email: z.string().email(),
      full_name: z.string().trim().min(1).max(120).optional(),
      // Legacy coarse role kept for backwards compatibility (DB column is NOT NULL).
      role: z.enum(["tenant_admin", "tenant_analyst", "tenant_viewer"]).default("tenant_analyst"),
      role_ids: z.array(z.string().uuid()).max(25).default([]),
      group_ids: z.array(z.string().uuid()).max(25).default([]),
      bu_id: z.string().uuid().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    // Generate a raw token, store only its SHA-256 hash
    const rawToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const tokenHashBytes = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawToken))
    );
    const tokenHashHex = "\\x" + Array.from(tokenHashBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    const { data: row, error } = await context.supabase
      .from("tenant_invitations")
      .insert({
        tenant_id: data.tenant_id, email: data.email, role: data.role,
        full_name: data.full_name ?? null,
        invited_by: context.userId, token_hash: tokenHashHex as any,
        role_ids: data.role_ids, group_ids: data.group_ids,
        bu_id: data.bu_id ?? null,
      } as any)
      .select("id, email, full_name, role, role_ids, group_ids, bu_id, expires_at")
      .single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id,
      scope: "tenant", action: "member.invite",
      resource_type: "tenant_invitation", resource_id: row.id,
      context: {
        email: data.email, full_name: data.full_name ?? null, role: data.role,
        role_ids: data.role_ids, group_ids: data.group_ids, bu_id: data.bu_id ?? null,
      },
    } as any);
    return { ...row, token: rawToken };
  });


export const listInvitations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const { data: rows, error } = await context.supabase
      .from("tenant_invitations")
      .select("id, email, full_name, role, role_ids, group_ids, bu_id, accepted_at, expires_at, created_at")
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const revokeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: inv } = await context.supabase
      .from("tenant_invitations").select("tenant_id").eq("id", data.id).single();
    if (!inv) throw new Error("Not found");
    await assertTenantAdmin(context, (inv as any).tenant_id);
    const { error } = await context.supabase.from("tenant_invitations").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: (inv as any).tenant_id,
      scope: "tenant", action: "member.invite_revoke",
      resource_type: "tenant_invitation", resource_id: data.id, context: {},
    } as any);
    return { ok: true };
  });

export const updateMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      user_id: z.string().uuid(),
      role: z.enum(["tenant_admin", "tenant_analyst", "tenant_viewer"]),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const { error } = await context.supabase
      .from("tenant_members").update({ role: data.role })
      .eq("tenant_id", data.tenant_id).eq("user_id", data.user_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id,
      scope: "tenant", action: "member.role_update",
      resource_type: "tenant_member", resource_id: data.user_id,
      context: { role: data.role },
    } as any);
    return { ok: true };
  });

export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: z.string().uuid(), user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    if (data.user_id === context.userId) {
      const { count } = await context.supabase
        .from("tenant_members").select("id", { count: "exact", head: true })
        .eq("tenant_id", data.tenant_id).eq("role", "tenant_admin");
      if ((count ?? 0) <= 1) throw new Error("Cannot remove the last tenant admin.");
    }
    const { error } = await context.supabase
      .from("tenant_members").delete()
      .eq("tenant_id", data.tenant_id).eq("user_id", data.user_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id,
      scope: "tenant", action: "member.remove",
      resource_type: "tenant_member", resource_id: data.user_id, context: {},
    } as any);
    return { ok: true };
  });

export const acceptInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ token: z.string().min(8) }).parse(d))
  .handler(async ({ data, context }) => {
    const email = ((context.claims as any)?.email ?? "").toLowerCase();
    const { data: invRows, error } = await context.supabase
      .rpc("find_invitation_by_token", { _token: data.token });
    if (error) throw new Error(error.message);
    const invStub = Array.isArray(invRows) ? invRows[0] : invRows;
    if (!invStub) throw new Error("Invitation not found");

    // Refetch full row so we get role_ids/group_ids/bu_id
    const { data: inv } = await context.supabase
      .from("tenant_invitations")
      .select("id, tenant_id, email, role, role_ids, group_ids, bu_id, accepted_at, expires_at")
      .eq("id", (invStub as any).id)
      .single();
    if (!inv) throw new Error("Invitation not found");

    if ((inv as any).accepted_at) throw new Error("Already accepted");
    if (new Date((inv as any).expires_at) < new Date()) throw new Error("Expired");
    if (String((inv as any).email).toLowerCase() !== email) throw new Error("Invitation email does not match your account");

    const tenantId = (inv as any).tenant_id as string;
    const roleIds: string[] = (inv as any).role_ids ?? [];
    const groupIds: string[] = (inv as any).group_ids ?? [];
    const buId: string | null = (inv as any).bu_id ?? null;

    const { error: memberError } = await context.supabase.from("tenant_members").insert({
      tenant_id: tenantId, user_id: context.userId,
      role: (inv as any).role, invited_by: context.userId,
    });
    if (memberError) throw new Error("Invitation cannot be accepted for this account.");

    // Direct RBAC role grants (deduped via on_conflict ignored by DB unique key if any)
    if (roleIds.length) {
      const grants = roleIds.map((rid) => ({
        tenant_id: tenantId,
        user_id: context.userId,
        role_id: rid,
        bu_id: buId,
        granted_by: context.userId,
      }));
      await context.supabase.from("rbac_user_grants").insert(grants as any);
    }

    // Group memberships
    if (groupIds.length) {
      const mem = groupIds.map((gid) => ({
        group_id: gid,
        user_id: context.userId,
      }));
      await context.supabase.from("tenant_group_members").insert(mem as any);
    }

    await context.supabase.from("tenant_invitations")
      .update({ accepted_at: new Date().toISOString(), accepted_by: context.userId })
      .eq("id", (inv as any).id);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: tenantId,
      scope: "tenant", action: "member.invite_accept",
      resource_type: "tenant_invitation", resource_id: (inv as any).id,
      context: {
        role: (inv as any).role, role_ids: roleIds, group_ids: groupIds, bu_id: buId,
      },
    } as any);
    return { tenant_id: tenantId };
  });

/** Invitations addressed to the signed-in user's email (any tenant). */
export const listMyInvitations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const email = ((context.claims as any)?.email ?? "").toLowerCase();
    if (!email) return [];
    const { data, error } = await context.supabase
      .from("tenant_invitations")
      .select("id, tenant_id, email, role, expires_at, accepted_at, created_at, tenant:tenants(name, slug)")
      .ilike("email", email)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });
