import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const SCOPES = [
  "tenant_data_read",
  "tenant_data_write",
  "tenant_admin_impersonate",
  "secrets_read",
  "billing_admin",
  "audit_export",
  "full_platform",
] as const;
const ScopeEnum = z.enum(SCOPES);

async function assertPlatformAdmin(ctx: any) {
  const { data: ok } = await ctx.supabase.rpc("is_platform_admin", { _user_id: ctx.userId });
  if (!ok) throw new Error("Forbidden: platform admin required");
}

async function audit(ctx: any, action: string, grantId: string, payload: Record<string, unknown>) {
  await ctx.supabase.from("audit_log").insert({
    actor_user_id: ctx.userId,
    tenant_id: null,
    scope: "platform",
    action,
    resource_type: "break_glass_grant",
    resource_id: grantId,
    context: payload,
  } as any);
}

/* ---------------- Policies ---------------- */

export const listBreakGlassPolicies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await context.supabase
      .from("break_glass_policies")
      .select("*")
      .order("scope", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const UpdatePolicy = z.object({
  id: z.string().uuid(),
  max_duration_minutes: z.number().int().min(5).max(480).optional(),
  requires_approval: z.boolean().optional(),
  min_approvers: z.number().int().min(1).max(5).optional(),
  require_step_up: z.boolean().optional(),
  require_incident_ref: z.boolean().optional(),
  enabled: z.boolean().optional(),
});
export const updateBreakGlassPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: z.infer<typeof UpdatePolicy>) => UpdatePolicy.parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { id, ...patch } = data;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await context.supabase
      .from("break_glass_policies").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    await audit(context, "break_glass.policy.update", id, patch);
    return { ok: true };
  });

/* ---------------- Grants ---------------- */

const RequestGrant = z.object({
  scope: ScopeEnum,
  tenant_id: z.string().uuid().optional().nullable(),
  justification: z.string().min(20).max(2000),
  incident_ref: z.string().max(120).optional().nullable(),
  duration_minutes: z.number().int().min(5).max(480),
});
export const requestBreakGlass = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: z.infer<typeof RequestGrant>) => RequestGrant.parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);

    const { data: policy, error: pErr } = await context.supabase
      .from("break_glass_policies").select("*").eq("scope", data.scope).maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!policy || !policy.enabled) throw new Error("This scope is disabled");
    if (data.duration_minutes > policy.max_duration_minutes) {
      throw new Error(`Duration exceeds policy max of ${policy.max_duration_minutes} minutes`);
    }
    if (policy.require_incident_ref && !data.incident_ref) {
      throw new Error("Incident reference is required for this scope");
    }

    const { data: row, error } = await context.supabase
      .from("break_glass_grants").insert({
        scope: data.scope,
        tenant_id: data.tenant_id ?? null,
        requested_by: context.userId,
        justification: data.justification,
        incident_ref: data.incident_ref ?? null,
        requested_duration_minutes: data.duration_minutes,
        status: policy.requires_approval ? "pending" : "active",
        activated_at: policy.requires_approval ? null : new Date().toISOString(),
        expires_at: policy.requires_approval
          ? null
          : new Date(Date.now() + data.duration_minutes * 60_000).toISOString(),
      } as any)
      .select("id, grant_uid, status")
      .single();
    if (error) throw new Error(error.message);

    await audit(context, "break_glass.request", row.id, {
      scope: data.scope,
      tenant_id: data.tenant_id ?? null,
      duration_minutes: data.duration_minutes,
      incident_ref: data.incident_ref ?? null,
    });
    return row;
  });

const Decide = z.object({
  grant_id: z.string().uuid(),
  decision: z.enum(["approve", "deny"]),
  reason: z.string().max(500).optional(),
});
export const decideBreakGlass = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: z.infer<typeof Decide>) => Decide.parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);

    const { data: grant, error: gErr } = await context.supabase
      .from("break_glass_grants").select("*").eq("id", data.grant_id).maybeSingle();
    if (gErr) throw new Error(gErr.message);
    if (!grant) throw new Error("Grant not found");
    if (grant.status !== "pending") throw new Error(`Grant is ${grant.status}; cannot decide`);
    if (grant.requested_by === context.userId) {
      throw new Error("Requester cannot approve their own grant (4-eyes)");
    }

    const { data: policy } = await context.supabase
      .from("break_glass_policies").select("min_approvers").eq("scope", grant.scope).maybeSingle();
    const minApprovers = policy?.min_approvers ?? 1;

    const { error: aErr } = await context.supabase
      .from("break_glass_approvals").insert({
        grant_id: grant.id,
        approver_user_id: context.userId,
        decision: data.decision,
        reason: data.reason ?? null,
      } as any);
    if (aErr) throw new Error(aErr.message);

    if (data.decision === "deny") {
      await context.supabase.from("break_glass_grants")
        .update({ status: "denied" }).eq("id", grant.id);
      await audit(context, "break_glass.deny", grant.id, { reason: data.reason ?? null });
      return { status: "denied" };
    }

    // Count approvals so far
    const { count } = await context.supabase
      .from("break_glass_approvals")
      .select("id", { count: "exact", head: true })
      .eq("grant_id", grant.id)
      .eq("decision", "approve");
    const approvals = count ?? 0;

    await context.supabase
      .from("break_glass_grants").update({ approver_count: approvals }).eq("id", grant.id);

    if (approvals >= minApprovers) {
      const now = new Date();
      const expires = new Date(now.getTime() + grant.requested_duration_minutes * 60_000);
      const { error: uErr } = await context.supabase
        .from("break_glass_grants").update({
          status: "active",
          activated_at: now.toISOString(),
          expires_at: expires.toISOString(),
        }).eq("id", grant.id);
      if (uErr) throw new Error(uErr.message);
      await audit(context, "break_glass.activate", grant.id, {
        approvers: approvals,
        expires_at: expires.toISOString(),
      });
      return { status: "active", expires_at: expires.toISOString() };
    }

    await audit(context, "break_glass.approve", grant.id, {
      approvals,
      min_required: minApprovers,
    });
    return { status: "pending", approvals, min_required: minApprovers };
  });

const Revoke = z.object({
  grant_id: z.string().uuid(),
  reason: z.string().min(5).max(500),
});
export const revokeBreakGlass = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: z.infer<typeof Revoke>) => Revoke.parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { data: g } = await context.supabase
      .from("break_glass_grants").select("status").eq("id", data.grant_id).maybeSingle();
    if (!g) throw new Error("Grant not found");
    if (g.status !== "active" && g.status !== "pending") {
      throw new Error(`Grant is already ${g.status}`);
    }
    const { error } = await context.supabase
      .from("break_glass_grants").update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        revoked_by: context.userId,
        revoke_reason: data.reason,
      }).eq("id", data.grant_id);
    if (error) throw new Error(error.message);
    await audit(context, "break_glass.revoke", data.grant_id, { reason: data.reason });
    return { ok: true };
  });

/* ---------------- Read endpoints ---------------- */

export const listBreakGlassGrants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { status?: string; limit?: number }) =>
    z.object({
      status: z.enum(["pending", "active", "expired", "revoked", "denied", "all"]).default("all"),
      limit: z.number().int().min(1).max(500).default(100),
    }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    // Auto-expire stale rows lazily
    await context.supabase.rpc("bg_expire_grants" as any);

    let q = context.supabase
      .from("break_glass_grants")
      .select(`
        id, grant_uid, scope, status, tenant_id, requested_by, justification, incident_ref,
        requested_duration_minutes, activated_at, expires_at, revoked_at, revoked_by,
        revoke_reason, approver_count, created_at,
        tenant:tenants(id, name, slug)
      `)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const userIds = Array.from(new Set((rows ?? []).map((r: any) => r.requested_by).filter(Boolean)));
    let profiles: any[] = [];
    if (userIds.length) {
      const { data: ps } = await context.supabase
        .from("profiles").select("id, email, full_name").in("id", userIds);
      profiles = ps ?? [];
    }
    const pMap = new Map(profiles.map((p) => [p.id, p]));
    return (rows ?? []).map((r: any) => ({ ...r, requester: pMap.get(r.requested_by) ?? null }));
  });

export const getBreakGlassGrant = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { grant_id: string }) =>
    z.object({ grant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { data: grant, error } = await context.supabase
      .from("break_glass_grants")
      .select(`*, tenant:tenants(id, name, slug)`)
      .eq("id", data.grant_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!grant) throw new Error("Not found");

    const [{ data: approvalsRaw }, { data: activitiesRaw }] = await Promise.all([
      context.supabase
        .from("break_glass_approvals")
        .select("*")
        .eq("grant_id", data.grant_id)
        .order("decided_at", { ascending: true }),
      context.supabase
        .from("break_glass_activities")
        .select("*")
        .eq("grant_id", data.grant_id)
        .order("occurred_at", { ascending: false })
        .limit(200),
    ]);

    const userIds = Array.from(new Set([
      grant.requested_by,
      grant.revoked_by,
      ...(approvalsRaw ?? []).map((a: any) => a.approver_user_id),
      ...(activitiesRaw ?? []).map((a: any) => a.actor_user_id),
    ].filter(Boolean)));
    let pMap = new Map<string, any>();
    if (userIds.length) {
      const { data: ps } = await context.supabase
        .from("profiles").select("id, email, full_name").in("id", userIds);
      pMap = new Map((ps ?? []).map((p: any) => [p.id, p]));
    }
    const grantWithReq = { ...grant, requester: pMap.get(grant.requested_by) ?? null };
    const approvals = (approvalsRaw ?? []).map((a: any) => ({ ...a, approver: pMap.get(a.approver_user_id) ?? null }));
    const activities = (activitiesRaw ?? []).map((a: any) => ({ ...a, actor: pMap.get(a.actor_user_id) ?? null }));
    return { grant: grantWithReq, approvals, activities };
  });

const LogActivity = z.object({
  grant_id: z.string().uuid(),
  action: z.string().min(2).max(120),
  resource_type: z.string().max(80).optional(),
  resource_id: z.string().max(120).optional(),
  payload: z.record(z.string(), z.any()).default({}),
});
export const logBreakGlassActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: z.infer<typeof LogActivity>) => LogActivity.parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { data: g } = await context.supabase
      .from("break_glass_grants").select("status, requested_by, expires_at")
      .eq("id", data.grant_id).maybeSingle();
    if (!g) throw new Error("Grant not found");
    if (g.requested_by !== context.userId) throw new Error("Only the requester can act under a grant");
    if (g.status !== "active") throw new Error(`Grant is ${g.status}`);
    if (g.expires_at && new Date(g.expires_at) <= new Date()) {
      throw new Error("Grant expired");
    }
    const { error } = await context.supabase.from("break_glass_activities").insert({
      grant_id: data.grant_id,
      actor_user_id: context.userId,
      action: data.action,
      resource_type: data.resource_type ?? null,
      resource_id: data.resource_id ?? null,
      payload: data.payload,
    } as any);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
