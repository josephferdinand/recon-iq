// ─────────────────────────────────────────────────────────────────────────────
// Tenant Administration server functions — CRUD + operations for every new
// tenant-admin surface introduced in the T-1…T-34 build wave.
//   Tables covered:
//     workspaces, workspace_members, workspace_quotas, workspace_templates,
//     teams, team_members, access_review_campaigns, access_review_items,
//     conditional_access_rules, risk_auth_policies,
//     secret_access_approvals, secret_rotation_policies,
//     tenant_email_templates, tenant_notification_channels,
//     tenant_notification_preferences, tenant_maintenance_windows,
//     tenant_compliance_profiles, tenant_policy_compliance,
//     tenant_dashboard_scores, tenant_report_definitions.
//   Auth: every fn requires signed-in user; write-scope enforced by RLS
//   (can_admin_tenant) and/or explicit is_platform_admin check.
// ─────────────────────────────────────────────────────────────────────────────
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { REPORT_DEFINITION_FORMATS } from "@/lib/report-export-formats";

const TenantScope = z.object({ tenantId: z.string().uuid() });

// ───────────────────────── T-5 · Workspaces ──────────────────────────────────
export const listWorkspaces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("workspaces")
      .select("*")
      .eq("tenant_id", data.tenantId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return rows ?? [];
  });

export const upsertWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) =>
    z.object({
      id: z.string().uuid().optional(),
      tenantId: z.string().uuid(),
      name: z.string().min(1).max(120),
      slug: z.string().regex(/^[a-z0-9-]{1,60}$/),
      description: z.string().max(500).optional().nullable(),
      department: z.string().max(120).optional().nullable(),
      businessUnitId: z.string().uuid().optional().nullable(),
      region: z.string().max(40).optional().nullable(),
      dataResidency: z.string().max(40).optional().nullable(),
      templateId: z.string().uuid().optional().nullable(),
      status: z.enum(["active", "suspended", "archived", "deleting"]).default("active"),
    }).parse(i))
  .handler(async ({ data, context }) => {
    const payload: Record<string, unknown> = {
      tenant_id: data.tenantId,
      name: data.name,
      slug: data.slug,
      description: data.description ?? null,
      department: data.department ?? null,
      business_unit_id: data.businessUnitId ?? null,
      region: data.region ?? null,
      data_residency: data.dataResidency ?? null,
      template_id: data.templateId ?? null,
      status: data.status,
      owner_id: context.userId,
      created_by: context.userId,
    };
    if (data.id) delete payload.created_by;
    const q = data.id
      ? context.supabase.from("workspaces").update(payload as any).eq("id", data.id).select().single()
      : context.supabase.from("workspaces").insert(payload as any).select().single();
    const { data: row, error } = await q;
    if (error) throw error;
    return row;
  });

export const workspaceLifecycle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) =>
    z.object({
      id: z.string().uuid(),
      action: z.enum(["suspend", "archive", "restore", "delete"]),
    }).parse(i))
  .handler(async ({ data, context }) => {
    const nextStatus =
      data.action === "suspend" ? "suspended"
        : data.action === "archive" ? "archived"
        : data.action === "restore" ? "active"
        : "deleting";
    const { error } = await context.supabase
      .from("workspaces").update({ status: nextStatus }).eq("id", data.id);
    if (error) throw error;
    return { ok: true, status: nextStatus };
  });

export const transferWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) =>
    z.object({ id: z.string().uuid(), newOwnerId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("workspaces").update({ owner_id: data.newOwnerId }).eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// ───────────────────────── T-7 · Workspace Quotas ────────────────────────────
export const listWorkspaceQuotas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("workspace_quotas").select("*").eq("tenant_id", data.tenantId);
    if (error) throw error;
    return rows ?? [];
  });

export const upsertWorkspaceQuota = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) =>
    z.object({
      tenantId: z.string().uuid(),
      workspaceId: z.string().uuid(),
      storageGbSoft: z.number().nullable().optional(),
      storageGbHard: z.number().nullable().optional(),
      usersSoft: z.number().int().nullable().optional(),
      usersHard: z.number().int().nullable().optional(),
      aiSpendSoft: z.number().nullable().optional(),
      aiSpendHard: z.number().nullable().optional(),
      apiCallsSoft: z.number().int().nullable().optional(),
      apiCallsHard: z.number().int().nullable().optional(),
      enforcement: z.enum(["notify", "block", "throttle"]).default("notify"),
    }).parse(i))
  .handler(async ({ data, context }) => {
    const payload = {
      tenant_id: data.tenantId,
      workspace_id: data.workspaceId,
      storage_gb_soft: data.storageGbSoft ?? null,
      storage_gb_hard: data.storageGbHard ?? null,
      users_soft: data.usersSoft ?? null,
      users_hard: data.usersHard ?? null,
      ai_spend_usd_soft: data.aiSpendSoft ?? null,
      ai_spend_usd_hard: data.aiSpendHard ?? null,
      api_calls_soft: data.apiCallsSoft ?? null,
      api_calls_hard: data.apiCallsHard ?? null,
      enforcement: data.enforcement,
    };
    const { data: row, error } = await context.supabase
      .from("workspace_quotas")
      .upsert(payload as any, { onConflict: "workspace_id" })
      .select().single();
    if (error) throw error;
    return row;
  });

// ─────────────────────── T-10 · Workspace Templates ──────────────────────────
export const listWorkspaceTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({ tenantId: z.string().uuid().nullable().optional() }).parse(i))
  .handler(async ({ data, context }) => {
    const q = context.supabase.from("workspace_templates").select("*").eq("is_active", true);
    const { data: rows, error } = data.tenantId
      ? await q.or(`tenant_id.eq.${data.tenantId},tenant_id.is.null`)
      : await q;
    if (error) throw error;
    return rows ?? [];
  });

export const upsertWorkspaceTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) =>
    z.object({
      id: z.string().uuid().optional(),
      tenantId: z.string().uuid(),
      name: z.string().min(1).max(120),
      category: z.enum(["general", "department", "business_unit", "project", "industry"]),
      description: z.string().max(500).optional().nullable(),
      spec: z.record(z.string(), z.unknown()).default({}),
      isActive: z.boolean().default(true),
    }).parse(i))
  .handler(async ({ data, context }) => {
    const payload = {
      tenant_id: data.tenantId, name: data.name, category: data.category,
      description: data.description ?? null, spec: data.spec, is_active: data.isActive,
      created_by: context.userId,
    };
    const q = data.id
      ? context.supabase.from("workspace_templates").update(payload as any).eq("id", data.id).select().single()
      : context.supabase.from("workspace_templates").insert(payload as any).select().single();
    const { data: row, error } = await q;
    if (error) throw error;
    return row;
  });

// ───────────────────────────── T-11 · Teams ──────────────────────────────────
export const listTeams = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("teams").select("*").eq("tenant_id", data.tenantId).order("name");
    if (error) throw error;
    return rows ?? [];
  });

export const upsertTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) =>
    z.object({
      id: z.string().uuid().optional(),
      tenantId: z.string().uuid(),
      parentTeamId: z.string().uuid().optional().nullable(),
      name: z.string().min(1).max(120),
      slug: z.string().regex(/^[a-z0-9-]{1,60}$/),
      description: z.string().max(500).optional().nullable(),
      leadUserId: z.string().uuid().optional().nullable(),
      isActive: z.boolean().default(true),
    }).parse(i))
  .handler(async ({ data, context }) => {
    const payload = {
      tenant_id: data.tenantId,
      parent_team_id: data.parentTeamId ?? null,
      name: data.name, slug: data.slug,
      description: data.description ?? null,
      lead_user_id: data.leadUserId ?? null,
      is_active: data.isActive,
      created_by: context.userId,
    };
    const q = data.id
      ? context.supabase.from("teams").update(payload as any).eq("id", data.id).select().single()
      : context.supabase.from("teams").insert(payload as any).select().single();
    const { data: row, error } = await q;
    if (error) throw error;
    return row;
  });

// ────────────────── T-13 / T-32 · Access Review Campaigns ────────────────────
export const listAccessReviewCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("access_review_campaigns").select("*")
      .eq("tenant_id", data.tenantId).order("created_at", { ascending: false });
    if (error) throw error;
    return rows ?? [];
  });

export const upsertAccessReviewCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) =>
    z.object({
      id: z.string().uuid().optional(),
      tenantId: z.string().uuid(),
      name: z.string().min(1).max(160),
      description: z.string().max(1000).optional().nullable(),
      scope: z.enum(["tenant", "workspace", "team", "role", "entitlement"]),
      scopeRef: z.string().uuid().optional().nullable(),
      status: z.enum(["draft", "active", "closed", "cancelled"]).default("draft"),
      startsAt: z.string().datetime().optional().nullable(),
      dueAt: z.string().datetime().optional().nullable(),
    }).parse(i))
  .handler(async ({ data, context }) => {
    const payload = {
      tenant_id: data.tenantId, name: data.name,
      description: data.description ?? null, scope: data.scope,
      scope_ref: data.scopeRef ?? null, status: data.status,
      starts_at: data.startsAt ?? null, due_at: data.dueAt ?? null,
      created_by: context.userId,
    };
    const q = data.id
      ? context.supabase.from("access_review_campaigns").update(payload as any).eq("id", data.id).select().single()
      : context.supabase.from("access_review_campaigns").insert(payload as any).select().single();
    const { data: row, error } = await q;
    if (error) throw error;
    return row;
  });

export const recordAccessReviewDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) =>
    z.object({
      itemId: z.string().uuid(),
      decision: z.enum(["approved", "revoked", "modified", "pending"]),
      note: z.string().max(1000).optional().nullable(),
    }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("access_review_items")
      .update({
        decision: data.decision,
        decision_note: data.note ?? null,
        decided_at: new Date().toISOString(),
        reviewer_id: context.userId,
      }).eq("id", data.itemId);
    if (error) throw error;
    return { ok: true };
  });

// ────────────────── T-17 · Conditional Access Rules ──────────────────────────
export const listConditionalAccessRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("conditional_access_rules").select("*")
      .eq("tenant_id", data.tenantId).order("priority");
    if (error) throw error;
    return rows ?? [];
  });

export const upsertConditionalAccessRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) =>
    z.object({
      id: z.string().uuid().optional(),
      tenantId: z.string().uuid(),
      name: z.string().min(1).max(120),
      description: z.string().max(500).optional().nullable(),
      priority: z.number().int().min(1).max(9999).default(100),
      isEnabled: z.boolean().default(true),
      conditions: z.record(z.string(), z.unknown()).default({}),
      action: z.enum(["allow", "deny", "step_up", "session_limit"]),
      actionParams: z.record(z.string(), z.unknown()).default({}),
    }).parse(i))
  .handler(async ({ data, context }) => {
    const payload = {
      tenant_id: data.tenantId, name: data.name,
      description: data.description ?? null,
      priority: data.priority, is_enabled: data.isEnabled,
      conditions: data.conditions, action: data.action, action_params: data.actionParams,
      created_by: context.userId,
    };
    const q = data.id
      ? context.supabase.from("conditional_access_rules").update(payload as any).eq("id", data.id).select().single()
      : context.supabase.from("conditional_access_rules").insert(payload as any).select().single();
    const { data: row, error } = await q;
    if (error) throw error;
    return row;
  });

// ───────────────────── T-18 · Risk Auth Policies ─────────────────────────────
export const getRiskAuthPolicy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("risk_auth_policies").select("*").eq("tenant_id", data.tenantId).maybeSingle();
    if (error) throw error;
    return row;
  });

export const upsertRiskAuthPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) =>
    z.object({
      tenantId: z.string().uuid(),
      isEnabled: z.boolean().default(true),
      lowThreshold: z.number().int().min(0).max(100).default(30),
      mediumThreshold: z.number().int().min(0).max(100).default(60),
      highThreshold: z.number().int().min(0).max(100).default(80),
      stepUpMethods: z.array(z.string()).default(["totp", "webauthn"]),
      blockAction: z.enum(["deny", "challenge", "notify_admin"]).default("deny"),
    }).parse(i))
  .handler(async ({ data, context }) => {
    const payload = {
      tenant_id: data.tenantId, is_enabled: data.isEnabled,
      low_threshold: data.lowThreshold, medium_threshold: data.mediumThreshold,
      high_threshold: data.highThreshold, step_up_methods: data.stepUpMethods,
      block_action: data.blockAction,
    };
    const { data: row, error } = await context.supabase
      .from("risk_auth_policies").upsert(payload as any, { onConflict: "tenant_id" })
      .select().single();
    if (error) throw error;
    return row;
  });

// ──────────────── T-22 · Secret Access Approvals ─────────────────────────────
export const listSecretApprovals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("secret_access_approvals").select("*")
      .eq("tenant_id", data.tenantId).order("created_at", { ascending: false }).limit(200);
    if (error) throw error;
    return rows ?? [];
  });

export const requestSecretAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) =>
    z.object({
      tenantId: z.string().uuid(),
      secretId: z.string().uuid(),
      reason: z.string().min(4).max(1000),
      windowMinutes: z.number().int().min(5).max(240).default(30),
      requiredApprovals: z.number().int().min(1).max(5).default(2),
    }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("secret_access_approvals").insert({
        tenant_id: data.tenantId, secret_id: data.secretId,
        requester_id: context.userId, reason: data.reason,
        window_minutes: data.windowMinutes, required_approvals: data.requiredApprovals,
      }).select().single();
    if (error) throw error;
    return row;
  });

export const decideSecretAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) =>
    z.object({
      id: z.string().uuid(),
      decision: z.enum(["approve", "deny"]),
    }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: current, error: fetchErr } = await context.supabase
      .from("secret_access_approvals").select("*").eq("id", data.id).single();
    if (fetchErr) throw fetchErr;
    const approvals = Array.isArray(current.approvals) ? current.approvals : [];
    if (data.decision === "deny") {
      const { error } = await context.supabase
        .from("secret_access_approvals").update({ status: "denied" }).eq("id", data.id);
      if (error) throw error;
      return { ok: true, status: "denied" };
    }
    const nextApprovals = [...approvals, { user: context.userId, at: new Date().toISOString() }];
    const approved = nextApprovals.length >= current.required_approvals;
    const patch: Record<string, unknown> = { approvals: nextApprovals };
    if (approved) {
      patch.status = "approved";
      patch.granted_at = new Date().toISOString();
      patch.expires_at = new Date(Date.now() + current.window_minutes * 60_000).toISOString();
    }
    const { error } = await context.supabase
      .from("secret_access_approvals").update(patch as any).eq("id", data.id);
    if (error) throw error;
    return { ok: true, status: approved ? "approved" : "pending", approvals: nextApprovals.length };
  });

// ─────────────── T-23 · Secret Rotation Policies ─────────────────────────────
export const listRotationPolicies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("secret_rotation_policies").select("*")
      .eq("tenant_id", data.tenantId).order("next_rotation_at", { ascending: true, nullsFirst: false });
    if (error) throw error;
    return rows ?? [];
  });

export const upsertRotationPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) =>
    z.object({
      id: z.string().uuid().optional(),
      tenantId: z.string().uuid(),
      secretId: z.string().uuid().nullable().optional(),
      category: z.string().max(60).nullable().optional(),
      rotationIntervalDays: z.number().int().min(1).max(3650).default(90),
      autoRotate: z.boolean().default(false),
      provider: z.string().max(60).nullable().optional(),
      alertDaysBefore: z.number().int().min(0).max(365).default(14),
      isActive: z.boolean().default(true),
    }).parse(i))
  .handler(async ({ data, context }) => {
    const payload = {
      tenant_id: data.tenantId, secret_id: data.secretId ?? null,
      category: data.category ?? null,
      rotation_interval_days: data.rotationIntervalDays,
      auto_rotate: data.autoRotate, provider: data.provider ?? null,
      alert_days_before: data.alertDaysBefore, is_active: data.isActive,
      next_rotation_at: new Date(Date.now() + data.rotationIntervalDays * 86_400_000).toISOString(),
    };
    const q = data.id
      ? context.supabase.from("secret_rotation_policies").update(payload as any).eq("id", data.id).select().single()
      : context.supabase.from("secret_rotation_policies").insert(payload as any).select().single();
    const { data: row, error } = await q;
    if (error) throw error;
    return row;
  });

// ─────────────── T-26 · Tenant Email Templates ───────────────────────────────
export const listEmailTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tenant_email_templates").select("*")
      .eq("tenant_id", data.tenantId).order("event_key");
    if (error) throw error;
    return rows ?? [];
  });

export const upsertEmailTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) =>
    z.object({
      id: z.string().uuid().optional(),
      tenantId: z.string().uuid(),
      eventKey: z.string().min(1).max(60),
      subject: z.string().min(1).max(300),
      htmlBody: z.string().min(1),
      textBody: z.string().nullable().optional(),
      fromName: z.string().max(120).nullable().optional(),
      fromEmail: z.string().email().nullable().optional(),
      replyTo: z.string().email().nullable().optional(),
      isActive: z.boolean().default(true),
      variables: z.record(z.string(), z.unknown()).default({}),
      version: z.number().int().min(1).default(1),
    }).parse(i))
  .handler(async ({ data, context }) => {
    const payload = {
      tenant_id: data.tenantId, event_key: data.eventKey,
      subject: data.subject, html_body: data.htmlBody, text_body: data.textBody ?? null,
      from_name: data.fromName ?? null, from_email: data.fromEmail ?? null,
      reply_to: data.replyTo ?? null, is_active: data.isActive,
      variables: data.variables, version: data.version, created_by: context.userId,
    };
    const q = data.id
      ? context.supabase.from("tenant_email_templates").update(payload as any).eq("id", data.id).select().single()
      : context.supabase.from("tenant_email_templates").insert(payload as any).select().single();
    const { data: row, error } = await q;
    if (error) throw error;
    return row;
  });

// ─────────── T-29 · Notification Channels + Preferences ──────────────────────
export const listNotificationChannels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tenant_notification_channels").select("*").eq("tenant_id", data.tenantId);
    if (error) throw error;
    return rows ?? [];
  });

export const upsertNotificationChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) =>
    z.object({
      tenantId: z.string().uuid(),
      channel: z.enum(["email", "sms", "push", "inapp", "slack", "webhook"]),
      isEnabled: z.boolean().default(true),
      digestSchedule: z.enum(["realtime", "hourly", "daily", "weekly"]).default("realtime"),
      config: z.record(z.string(), z.unknown()).default({}),
    }).parse(i))
  .handler(async ({ data, context }) => {
    const payload = {
      tenant_id: data.tenantId, channel: data.channel,
      is_enabled: data.isEnabled, digest_schedule: data.digestSchedule,
      config: data.config, updated_by: context.userId,
    };
    const { data: row, error } = await context.supabase
      .from("tenant_notification_channels")
      .upsert(payload as any, { onConflict: "tenant_id,channel" }).select().single();
    if (error) throw error;
    return row;
  });

export const listNotificationPreferences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tenant_notification_preferences").select("*").eq("tenant_id", data.tenantId).order("event_key");
    if (error) throw error;
    return rows ?? [];
  });

export const upsertNotificationPreference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) =>
    z.object({
      tenantId: z.string().uuid(),
      eventKey: z.string().min(1).max(60),
      channels: z.array(z.string()).default(["inapp"]),
      isOptInRequired: z.boolean().default(false),
      description: z.string().max(500).optional().nullable(),
    }).parse(i))
  .handler(async ({ data, context }) => {
    const payload = {
      tenant_id: data.tenantId, event_key: data.eventKey,
      channels: data.channels, is_opt_in_required: data.isOptInRequired,
      description: data.description ?? null,
    };
    const { data: row, error } = await context.supabase
      .from("tenant_notification_preferences")
      .upsert(payload as any, { onConflict: "tenant_id,event_key" }).select().single();
    if (error) throw error;
    return row;
  });

// ─────────────── T-30 · Maintenance Windows ──────────────────────────────────
export const listMaintenanceWindows = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tenant_maintenance_windows").select("*")
      .eq("tenant_id", data.tenantId).order("starts_at", { ascending: false }).limit(200);
    if (error) throw error;
    return rows ?? [];
  });

export const upsertMaintenanceWindow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) =>
    z.object({
      id: z.string().uuid().optional(),
      tenantId: z.string().uuid(),
      title: z.string().min(1).max(160),
      message: z.string().max(2000).optional().nullable(),
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime(),
      bannerSeverity: z.enum(["info", "warning", "critical"]).default("info"),
      blockWrites: z.boolean().default(false),
      broadcastChannels: z.array(z.string()).default(["inapp"]),
      status: z.enum(["scheduled", "active", "completed", "cancelled"]).default("scheduled"),
    }).parse(i))
  .handler(async ({ data, context }) => {
    const payload = {
      tenant_id: data.tenantId, title: data.title, message: data.message ?? null,
      starts_at: data.startsAt, ends_at: data.endsAt,
      banner_severity: data.bannerSeverity, block_writes: data.blockWrites,
      broadcast_channels: data.broadcastChannels, status: data.status,
      created_by: context.userId,
    };
    const q = data.id
      ? context.supabase.from("tenant_maintenance_windows").update(payload as any).eq("id", data.id).select().single()
      : context.supabase.from("tenant_maintenance_windows").insert(payload as any).select().single();
    const { data: row, error } = await q;
    if (error) throw error;
    return row;
  });

// ─────────────── T-31 · Compliance Profile ───────────────────────────────────
export const getComplianceProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("tenant_compliance_profiles").select("*").eq("tenant_id", data.tenantId).maybeSingle();
    if (error) throw error;
    return row;
  });

export const upsertComplianceProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) =>
    z.object({
      tenantId: z.string().uuid(),
      gdprEnabled: z.boolean().default(false),
      ccpaEnabled: z.boolean().default(false),
      doraEnabled: z.boolean().default(false),
      piplEnabled: z.boolean().default(false),
      hipaaEnabled: z.boolean().default(false),
      soc2Enabled: z.boolean().default(true),
      iso27001Enabled: z.boolean().default(false),
      customFrameworks: z.array(z.string()).default([]),
      policyDefaults: z.record(z.string(), z.unknown()).default({}),
    }).parse(i))
  .handler(async ({ data, context }) => {
    const payload = {
      tenant_id: data.tenantId,
      gdpr_enabled: data.gdprEnabled, ccpa_enabled: data.ccpaEnabled,
      dora_enabled: data.doraEnabled, pipl_enabled: data.piplEnabled,
      hipaa_enabled: data.hipaaEnabled, soc2_enabled: data.soc2Enabled,
      iso27001_enabled: data.iso27001Enabled,
      custom_frameworks: data.customFrameworks, policy_defaults: data.policyDefaults,
      updated_by: context.userId,
    };
    const { data: row, error } = await context.supabase
      .from("tenant_compliance_profiles").upsert(payload as any, { onConflict: "tenant_id" }).select().single();
    if (error) throw error;
    return row;
  });

// ─────────────── T-33 · Policy Compliance Tracking ───────────────────────────
export const listPolicyCompliance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tenant_policy_compliance").select("*")
      .eq("tenant_id", data.tenantId).order("framework").order("control_id");
    if (error) throw error;
    return rows ?? [];
  });

export const upsertPolicyCompliance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) =>
    z.object({
      id: z.string().uuid().optional(),
      tenantId: z.string().uuid(),
      controlId: z.string().min(1).max(60),
      framework: z.string().min(1).max(40),
      status: z.enum(["not_started", "implemented", "tested", "failing", "expired", "waived"]),
      ownerId: z.string().uuid().nullable().optional(),
      lastTestedAt: z.string().datetime().nullable().optional(),
      nextTestDue: z.string().datetime().nullable().optional(),
      evidenceUrl: z.string().url().nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
      score: z.number().int().min(0).max(100).nullable().optional(),
    }).parse(i))
  .handler(async ({ data, context }) => {
    const payload = {
      tenant_id: data.tenantId, control_id: data.controlId, framework: data.framework,
      status: data.status, owner_id: data.ownerId ?? null,
      last_tested_at: data.lastTestedAt ?? null, next_test_due: data.nextTestDue ?? null,
      evidence_url: data.evidenceUrl ?? null, notes: data.notes ?? null, score: data.score ?? null,
    };
    const { data: row, error } = await context.supabase
      .from("tenant_policy_compliance")
      .upsert(payload as any, { onConflict: "tenant_id,framework,control_id" }).select().single();
    if (error) throw error;
    return row;
  });

// ─────────────── T-2 · Dashboard Scores ──────────────────────────────────────
export const listDashboardScores = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tenant_dashboard_scores").select("*").eq("tenant_id", data.tenantId);
    if (error) throw error;
    return rows ?? [];
  });

export const recomputeDashboardScores = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    // Simple heuristic composite: base + audit-friendliness signals
    const supa = context.supabase;
    const [
      { count: mfaCount }, { count: memberCount },
      { count: openApprovals }, { count: rotationsDue },
      { count: failingControls }, { count: totalControls },
    ] = await Promise.all([
      supa.from("mfa_recovery_codes").select("*", { count: "exact", head: true }),
      supa.from("tenant_members").select("*", { count: "exact", head: true }).eq("tenant_id", data.tenantId),
      supa.from("secret_access_approvals").select("*", { count: "exact", head: true })
        .eq("tenant_id", data.tenantId).eq("status", "pending"),
      supa.from("secret_rotation_policies").select("*", { count: "exact", head: true })
        .eq("tenant_id", data.tenantId).lte("next_rotation_at", new Date().toISOString()),
      supa.from("tenant_policy_compliance").select("*", { count: "exact", head: true })
        .eq("tenant_id", data.tenantId).in("status", ["failing", "expired"]),
      supa.from("tenant_policy_compliance").select("*", { count: "exact", head: true })
        .eq("tenant_id", data.tenantId),
    ]);
    const mfaPct = memberCount ? Math.min(100, Math.round((mfaCount ?? 0) / memberCount * 100)) : 0;
    const securityScore = Math.max(0, Math.min(100,
      70 + Math.round(mfaPct * 0.2) - (openApprovals ?? 0) * 3 - (rotationsDue ?? 0) * 2));
    const complianceScore = totalControls
      ? Math.max(0, Math.min(100, 100 - Math.round((failingControls ?? 0) / totalControls * 100)))
      : 80;
    const scores = [
      { score_key: "security", score_value: securityScore, breakdown: { mfaPct, openApprovals, rotationsDue } },
      { score_key: "compliance", score_value: complianceScore, breakdown: { failingControls, totalControls } },
    ];
    for (const s of scores) {
      await supa.from("tenant_dashboard_scores").upsert({
        tenant_id: data.tenantId, ...s, computed_at: new Date().toISOString(),
      }, { onConflict: "tenant_id,score_key" });
    }
    return { ok: true, scores };
  });

// ─────────────── T-34 · Report Definitions ───────────────────────────────────
export const listReportDefinitions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tenant_report_definitions").select("*").eq("tenant_id", data.tenantId).order("name");
    if (error) throw error;
    return rows ?? [];
  });

export const upsertReportDefinition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) =>
    z.object({
      id: z.string().uuid().optional(),
      tenantId: z.string().uuid(),
      name: z.string().min(1).max(160),
      category: z.enum(["security", "ai", "users", "compliance", "usage", "cost", "custom"]),
      description: z.string().max(1000).optional().nullable(),
      querySpec: z.record(z.string(), z.unknown()).default({}),
      format: z.enum(REPORT_DEFINITION_FORMATS).default("csv"),
      scheduleCron: z.string().max(60).optional().nullable(),
      recipients: z.array(z.string().email()).default([]),
      isActive: z.boolean().default(true),
    }).parse(i))
  .handler(async ({ data, context }) => {
    const payload = {
      tenant_id: data.tenantId, name: data.name, category: data.category,
      description: data.description ?? null, query_spec: data.querySpec, format: data.format,
      schedule_cron: data.scheduleCron ?? null, recipients: data.recipients,
      is_active: data.isActive, created_by: context.userId,
    };
    const q = data.id
      ? context.supabase.from("tenant_report_definitions").update(payload as any).eq("id", data.id).select().single()
      : context.supabase.from("tenant_report_definitions").insert(payload as any).select().single();
    const { data: row, error } = await q;
    if (error) throw error;
    return row;
  });
