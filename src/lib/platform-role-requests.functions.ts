import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/rbac-guards.server";
import { z } from "zod";

async function isSuperAdmin(context: any): Promise<boolean> {
  const { data } = await context.supabase.rpc("is_platform_super_admin", { _user_id: context.userId });
  return Boolean(data);
}

const CreateInput = z.object({
  requested_role: z.enum(["platform_super_admin"]).default("platform_super_admin"),
  reason: z.string().trim().min(10, "Provide at least 10 characters of justification").max(2000),
});

export const requestPlatformRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => CreateInput.parse(d))
  .handler(async ({ data, context }) => {
    // Only existing platform admins/members may self-serve request elevation
    await requirePlatformAdmin(context, { fnName: "request-platform-role" });
    // Reject if already has it
    if (await isSuperAdmin(context)) {
      throw new Error("You already have the Platform Super Admin role.");
    }

    const { data: row, error } = await context.supabase
      .from("platform_role_requests")
      .insert({
        requester_id: context.userId,
        requested_role: data.requested_role,
        reason: data.reason,
      })
      .select("id, status, created_at, requested_role")
      .single();
    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        throw new Error("You already have a pending request for this role.");
      }
      throw new Error(error.message);
    }

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      scope: "platform",
      action: "platform_role_request.create",
      resource_type: "platform_role_request",
      resource_id: row.id,
      context: { requested_role: data.requested_role, reason: data.reason },
    } as any);

    return row;
  });

export const listMyPlatformRoleRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("platform_role_requests")
      .select("id, requested_role, reason, status, decided_at, decision_note, created_at")
      .eq("requester_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const ListInput = z.object({
  status: z.enum(["pending", "approved", "denied", "cancelled", "all"]).default("pending"),
});

export const listPlatformRoleRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => ListInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    if (!(await isSuperAdmin(context))) throw new Error("Forbidden");
    let q = context.supabase
      .from("platform_role_requests")
      .select("id, requester_id, requested_role, reason, status, decided_by, decided_at, decision_note, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const uids = Array.from(
      new Set(
        (rows ?? []).flatMap((r: any) => [r.requester_id, r.decided_by].filter(Boolean)),
      ),
    );
    let profiles: any[] = [];
    if (uids.length) {
      const { data: profs } = await context.supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", uids);
      profiles = profs ?? [];
    }
    const byId = new Map(profiles.map((p) => [p.id, p]));
    return (rows ?? []).map((r: any) => ({
      ...r,
      requester: byId.get(r.requester_id) ?? null,
      decider: r.decided_by ? byId.get(r.decided_by) ?? null : null,
    }));
  });

const DecideInput = z.object({
  request_id: z.string().uuid(),
  decision: z.enum(["approved", "denied"]),
  note: z.string().trim().max(2000).optional(),
});

export const decidePlatformRoleRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => DecideInput.parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isSuperAdmin(context))) throw new Error("Forbidden");

    const { data: req, error: fetchErr } = await context.supabase
      .from("platform_role_requests")
      .select("id, requester_id, requested_role, status")
      .eq("id", data.request_id)
      .single();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!req) throw new Error("Request not found");
    if (req.status !== "pending") throw new Error(`Request is already ${req.status}`);
    if (req.requester_id === context.userId) {
      throw new Error("You cannot decide your own role request.");
    }

    const { error: updErr } = await context.supabase
      .from("platform_role_requests")
      .update({
        status: data.decision,
        decided_by: context.userId,
        decided_at: new Date().toISOString(),
        decision_note: data.note ?? null,
      })
      .eq("id", data.request_id)
      .eq("status", "pending");
    if (updErr) throw new Error(updErr.message);

    if (data.decision === "approved") {
      const { error: grantErr } = await context.supabase
        .from("platform_roles")
        .insert({
          user_id: req.requester_id,
          role: req.requested_role,
          granted_by: context.userId,
        });
      if (grantErr && !/duplicate/i.test(grantErr.message)) {
        throw new Error(grantErr.message);
      }
      await context.supabase.from("audit_log").insert({
        actor_user_id: context.userId,
        scope: "platform",
        action: "platform_role.grant",
        resource_type: "platform_role",
        resource_id: req.requester_id,
        context: {
          role: req.requested_role,
          via: "self_serve_request",
          request_id: req.id,
        },
      } as any);
    }

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      scope: "platform",
      action: `platform_role_request.${data.decision === "approved" ? "approve" : "deny"}`,
      resource_type: "platform_role_request",
      resource_id: req.id,
      context: {
        requester_id: req.requester_id,
        requested_role: req.requested_role,
        note: data.note ?? null,
      },
    } as any);

    return { ok: true };
  });

const CancelInput = z.object({ request_id: z.string().uuid() });

export const cancelPlatformRoleRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => CancelInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: req, error: fetchErr } = await context.supabase
      .from("platform_role_requests")
      .select("id, requester_id, status, requested_role")
      .eq("id", data.request_id)
      .single();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!req) throw new Error("Request not found");
    if (req.requester_id !== context.userId) throw new Error("Forbidden");
    if (req.status !== "pending") throw new Error("Only pending requests can be cancelled.");

    const { error } = await context.supabase
      .from("platform_role_requests")
      .update({ status: "cancelled", decided_at: new Date().toISOString() })
      .eq("id", data.request_id)
      .eq("requester_id", context.userId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      scope: "platform",
      action: "platform_role_request.cancel",
      resource_type: "platform_role_request",
      resource_id: req.id,
      context: { requested_role: req.requested_role },
    } as any);

    return { ok: true };
  });
