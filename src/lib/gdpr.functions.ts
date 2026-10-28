import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// GDPR: Article 15 (right of access / export) + Article 17 (erasure request).
// Export streams the signed-in user's own data; erasure logs a tracked,
// audit-chained request that Platform Admins action via the audit log.

export const exportMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const uid = context.userId;
    const [profile, memberships, threads, events] = await Promise.all([
      sb.from("profiles").select("id, email, full_name, avatar_url, default_tenant_id, created_at, updated_at").eq("id", uid).maybeSingle(),
      sb.from("tenant_members").select("tenant_id, role, created_at").eq("user_id", uid),
      sb.from("copilot_threads").select("id, scope, tenant_id, title, created_at").eq("user_id", uid),
      sb.from("audit_log").select("id, action, scope, resource_type, occurred_at").eq("actor_user_id", uid).order("occurred_at", { ascending: false }).limit(500),
    ]);
    await sb.from("audit_log").insert({
      actor_user_id: uid, scope: "platform", action: "gdpr.export.requested",
      resource_type: "profile", resource_id: uid, context: {},
    } as any);
    return {
      exported_at: new Date().toISOString(),
      user_id: uid,
      profile: profile.data,
      memberships: memberships.data ?? [],
      copilot_threads: threads.data ?? [],
      recent_audit_events: events.data ?? [],
    };
  });

export const requestErasure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    reason: z.string().trim().min(10).max(2000),
    tenant_id: z.string().uuid().nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    await sb.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id ?? null,
      scope: "platform",
      action: "gdpr.erasure.requested",
      resource_type: "profile",
      resource_id: context.userId,
      context: { reason: data.reason.slice(0, 2000) },
    } as any);
    await sb.from("security_events").insert({
      tenant_id: data.tenant_id ?? null, user_id: context.userId,
      event_type: "gdpr.erasure.requested", severity: "warning",
      context: { reason_chars: data.reason.length },
    } as any);
    return { ok: true };
  });

export const signOutEverywhere = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Revoke all refresh tokens for this user (forces re-login on every device).
    try {
      // @ts-ignore - admin signOut signature varies by version
      await supabaseAdmin.auth.admin.signOut(context.userId, "global");
    } catch { /* fall through */ }
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, scope: "platform",
      action: "auth.sign_out_everywhere",
      resource_type: "profile", resource_id: context.userId, context: {},
    } as any);
    await context.supabase.from("security_events").insert({
      tenant_id: null, user_id: context.userId,
      event_type: "auth.sign_out_everywhere", severity: "info", context: {},
    } as any);
    return { ok: true };
  });
