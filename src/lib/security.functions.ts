import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantAdmin } from "@/lib/rbac-guards.server";
import { z } from "zod";

async function assertTenantAdmin(ctx: any, tenantId: string) {
  await requireTenantAdmin(ctx, tenantId, { fnName: "security" });
}

// ---------- Security settings ----------
export const getSecuritySettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    let { data: row } = await context.supabase
      .from("tenant_security_settings").select("*").eq("tenant_id", data.tenant_id).maybeSingle();
    if (!row) {
      // Auto-create defaults on first read
      const { data: ins } = await context.supabase
        .from("tenant_security_settings").insert({ tenant_id: data.tenant_id })
        .select("*").single();
      row = ins;
    }
    return row;
  });

const UpdateSettings = z.object({
  tenant_id: z.string().uuid(),
  mfa_required: z.boolean().optional(),
  ip_allowlist_enabled: z.boolean().optional(),
  session_max_age_minutes: z.number().int().min(15).max(60 * 24 * 30).optional(),
  max_uploads_per_hour: z.number().int().min(1).max(10000).optional(),
  max_runs_per_hour: z.number().int().min(1).max(10000).optional(),
  // Passkeys / WebAuthn policy
  passkeys_enabled: z.boolean().optional(),
  passkeys_required: z.boolean().optional(),
  passkeys_user_verification: z.enum(["required", "preferred", "discouraged"]).optional(),
  passkeys_allow_platform_authenticators: z.boolean().optional(),
  passkeys_allow_roaming_authenticators: z.boolean().optional(),
});
export const updateSecuritySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: z.infer<typeof UpdateSettings>) => UpdateSettings.parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const { tenant_id, ...patch } = data;
    if (Object.keys(patch).length === 0) return { ok: true };
    // Detect passkey-policy fields for a dedicated audit action + stamp
    const passkeyKeys = [
      "passkeys_enabled", "passkeys_required", "passkeys_user_verification",
      "passkeys_allow_platform_authenticators", "passkeys_allow_roaming_authenticators",
    ] as const;
    const passkeyPatch: Record<string, unknown> = {};
    for (const k of passkeyKeys) if (k in patch) passkeyPatch[k] = (patch as any)[k];
    const finalPatch: Record<string, unknown> = { ...patch };
    if (Object.keys(passkeyPatch).length > 0) {
      finalPatch.passkeys_policy_updated_at = new Date().toISOString();
      finalPatch.passkeys_policy_updated_by = context.userId;
    }
    // Snapshot previous values so the audit entry captures the diff.
    const { data: prev } = await context.supabase
      .from("tenant_security_settings").select("*").eq("tenant_id", tenant_id).maybeSingle();
    const { error } = await context.supabase
      .from("tenant_security_settings").update(finalPatch as any).eq("tenant_id", tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id, scope: "tenant",
      action: "security.settings.update", resource_type: "tenant_security_settings",
      resource_id: tenant_id, context: patch,
    } as any);
    if (Object.keys(passkeyPatch).length > 0) {
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const k of Object.keys(passkeyPatch)) {
        before[k] = (prev as any)?.[k] ?? null;
        after[k] = passkeyPatch[k];
      }
      await context.supabase.from("audit_log").insert({
        actor_user_id: context.userId, tenant_id, scope: "tenant",
        action: "security.passkey_policy.update", resource_type: "tenant_security_settings",
        resource_id: tenant_id, context: { before, after },
      } as any);
    }
    return { ok: true };
  });

/** Count WebAuthn credentials registered by users who belong to this tenant. */
export const getTenantPasskeyStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const { data: members } = await context.supabase
      .from("tenant_members").select("user_id").eq("tenant_id", data.tenant_id);
    const userIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);
    if (userIds.length === 0) return { member_count: 0, users_with_passkey: 0, credential_count: 0 };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: creds } = await supabaseAdmin
      .from("webauthn_credentials")
      .select("user_id")
      .in("user_id", userIds);
    const users = new Set((creds ?? []).map((c: any) => c.user_id));
    return {
      member_count: userIds.length,
      users_with_passkey: users.size,
      credential_count: creds?.length ?? 0,
    };
  });

/** Recent passkey-policy audit trail for a tenant. */
export const listPasskeyPolicyAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const { data: rows, error } = await context.supabase
      .from("audit_log")
      .select("id, created_at, actor_user_id, action, context")
      .eq("tenant_id", data.tenant_id)
      .eq("action", "security.passkey_policy.update")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ---------- IP allowlist ----------
export const listIpAllowlist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tenant_ip_allowlist")
      .select("id, cidr, label, created_at")
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const CIDR_RE =
  /^([0-9]{1,3}\.){3}[0-9]{1,3}(\/(3[0-2]|[12]?[0-9]))?$|^([0-9a-fA-F:]+)(\/(1[0-2][0-8]|[0-9]{1,2}))?$/;

const AddIp = z.object({
  tenant_id: z.string().uuid(),
  cidr: z.string().min(3).max(64).refine((v) => CIDR_RE.test(v.trim()), { message: "Invalid CIDR" }),
  label: z.string().max(80).optional(),
});
export const addIpAllowlistEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: z.infer<typeof AddIp>) => AddIp.parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const { data: row, error } = await context.supabase
      .from("tenant_ip_allowlist").insert({
        tenant_id: data.tenant_id, cidr: data.cidr.trim(),
        label: data.label ?? null, created_by: context.userId,
      }).select("id").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "security.ip_allowlist.add", resource_type: "tenant_ip_allowlist",
      resource_id: row.id, context: { cidr: data.cidr, label: data.label ?? null },
    } as any);
    return { id: row.id };
  });

export const removeIpAllowlistEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const { error } = await context.supabase
      .from("tenant_ip_allowlist").delete().eq("id", data.id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "security.ip_allowlist.remove", resource_type: "tenant_ip_allowlist",
      resource_id: data.id, context: {},
    } as any);
    return { ok: true };
  });

// ---------- Security events ----------
export const listSecurityEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; limit?: number }) =>
    z.object({ tenant_id: z.string().uuid(), limit: z.number().int().min(1).max(500).default(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("security_events")
      .select("id, occurred_at, user_id, ip, event_type, severity, context")
      .eq("tenant_id", data.tenant_id)
      .order("occurred_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const recordSecurityEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: {
    tenant_id?: string;
    event_type: string;
    severity?: string;
    context?: Record<string, unknown>;
  }) =>
    z.object({
      tenant_id: z.string().uuid().optional(),
      event_type: z.string().min(2).max(80),
      severity: z.enum(["info", "warning", "critical"]).default("info"),
      context: z.record(z.string(), z.unknown()).default({}),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("security_events").insert({
      tenant_id: data.tenant_id ?? null, user_id: context.userId,
      event_type: data.event_type, severity: data.severity, context: data.context,
    } as any);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Personal Security Audit (current user's auth events) ----------
const AUTH_EVENT_TYPES = [
  "auth.success_login",
  "auth.failed_login",
  "auth.logout",
  "auth.signup_success",
  "auth.signup_failed",
  "auth.password_reset_requested",
  "auth.password_reset_completed",
  "auth.password_reset_failed",
  "auth.mfa_failed",
  "auth.mfa_enroll_failed",
] as const;

export const listMyAuthEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: {
    event_types?: string[];
    severities?: ("info" | "warning" | "critical")[];
    since?: string;
    until?: string;
    search?: string;
    limit?: number;
  }) =>
    z.object({
      event_types: z.array(z.string()).max(20).optional(),
      severities: z.array(z.enum(["info", "warning", "critical"])).max(3).optional(),
      since: z.string().datetime().optional(),
      until: z.string().datetime().optional(),
      search: z.string().max(120).optional(),
      limit: z.number().int().min(1).max(500).default(200),
    }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("security_events")
      .select("id, occurred_at, event_type, severity, ip, context")
      .eq("user_id", context.userId)
      .order("occurred_at", { ascending: false })
      .limit(data.limit);

    if (data.event_types?.length) q = q.in("event_type", data.event_types);
    if (data.severities?.length) q = q.in("severity", data.severities);
    if (data.since) q = q.gte("occurred_at", data.since);
    if (data.until) q = q.lte("occurred_at", data.until);
    if (data.search) q = q.ilike("ip", `%${data.search}%`);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { events: rows ?? [], known_types: AUTH_EVENT_TYPES as readonly string[] };
  });
