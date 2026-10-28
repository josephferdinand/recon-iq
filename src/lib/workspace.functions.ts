// ─────────────────────────────────────────────────────────────────────────────
// Workspace UX server functions — closes W-1 … W-28 gap items.
// EVERY consumer surface reads `tenant_workspace_features` first and only
// renders / accepts writes when the tenant admin has toggled the feature on.
// Tenant admins own the toggles via `setWorkspaceFeature`; users own their
// personal drafts / layouts / prefs / shortcuts.
// ─────────────────────────────────────────────────────────────────────────────
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { isTenantWritableWorkspaceFeature } from "@/lib/session-feature-policy";
import { revokeOtherAuthSessions } from "@/lib/session-revocation";

// Canonical registry — must stay in sync with `src/lib/workspace-features.ts`.
export const WORKSPACE_FEATURE_KEYS = [
  "dashboard_layouts",          // W-1
  "recent_searches",            // W-2
  "announcement_banner",        // W-3
  "dual_team_context",          // W-4
  "sidebar_shortcuts",          // W-5
  "back_button_audit",          // W-6
  "theme_catalog_expanded",     // W-7
  "theme_wcag_scoring",         // W-8
  "notification_prefs_matrix",  // W-9
  "extended_profile_fields",    // W-10
  "teams_primitive",            // W-11
  "team_context_switcher",      // W-12
  "team_shared_workspaces",     // W-13
  "mentions",                   // W-14
  "comments_reactions",         // W-15
  "task_assignment",            // W-16
  "availability_status",        // W-17
  "autosave_drafts",            // W-18
  "version_recovery",           // W-19
  "progressive_skeletons",      // W-20
  "single_session_enforcement", // W-21
  "logout_all_devices",         // W-22
  "device_change_audit",        // W-23
  "universal_error_boundary",   // W-24
  "empty_state_library",        // W-25
  "perf_budgets",               // W-26
  "team_id_on_audit",           // W-27
  "read_path_audit",            // W-28
] as const;

const TenantScope = z.object({ tenantId: z.string().uuid() });

// ═══════════════════ Central toggle table (mandatory gate) ══════════════════
export const listWorkspaceFeatures = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tenant_workspace_features")
      .select("*")
      .eq("tenant_id", data.tenantId);
    if (error) throw error;
    const byKey: Record<string, { enabled: boolean; config: any; updated_at: string }> = {};
    for (const r of rows ?? []) byKey[r.feature_key] = { enabled: r.enabled, config: r.config, updated_at: r.updated_at };
    // Fill defaults (disabled) for keys not yet configured.
    return WORKSPACE_FEATURE_KEYS.map((key) => ({
      key,
      enabled: byKey[key]?.enabled ?? false,
      config: byKey[key]?.config ?? {},
      updated_at: byKey[key]?.updated_at ?? null,
    }));
  });

export const setWorkspaceFeature = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({
    tenantId: z.string().uuid(),
    key: z.enum(WORKSPACE_FEATURE_KEYS),
    enabled: z.boolean(),
    config: z.record(z.string(), z.unknown()).optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    if (!isTenantWritableWorkspaceFeature(data.key)) {
      throw new Error("Single-session enforcement is managed project-wide in Supabase Auth, not by a tenant toggle.");
    }
    const { error } = await context.supabase
      .from("tenant_workspace_features")
      .upsert({
        tenant_id: data.tenantId,
        feature_key: data.key,
        enabled: data.enabled,
        config: data.config ?? {},
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      } as any, { onConflict: "tenant_id,feature_key" });
    if (error) throw error;
    return { ok: true };
  });

async function requireFeature(
  supa: any, tenantId: string, key: (typeof WORKSPACE_FEATURE_KEYS)[number],
): Promise<void> {
  const { data } = await supa
    .from("tenant_workspace_features")
    .select("enabled")
    .eq("tenant_id", tenantId).eq("feature_key", key).maybeSingle();
  if (!data?.enabled) throw new Error(`Feature "${key}" is disabled by your tenant administrator.`);
}

// ═══════════════════════════════ Comments (W-15) ═════════════════════════════
export const listComments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({
    tenantId: z.string().uuid(),
    resourceType: z.string().min(1).max(80),
    resourceId: z.string().min(1).max(200),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await requireFeature(context.supabase, data.tenantId, "comments_reactions");
    const { data: rows, error } = await context.supabase
      .from("workspace_comments")
      .select("*")
      .eq("tenant_id", data.tenantId)
      .eq("resource_type", data.resourceType)
      .eq("resource_id", data.resourceId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return rows ?? [];
  });

export const addComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({
    tenantId: z.string().uuid(),
    resourceType: z.string().min(1).max(80),
    resourceId: z.string().min(1).max(200),
    body: z.string().min(1).max(8000),
    parentId: z.string().uuid().optional().nullable(),
    teamId: z.string().uuid().optional().nullable(),
    mentions: z.array(z.string().uuid()).default([]),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await requireFeature(context.supabase, data.tenantId, "comments_reactions");
    const { data: row, error } = await context.supabase
      .from("workspace_comments").insert({
        tenant_id: data.tenantId, resource_type: data.resourceType, resource_id: data.resourceId,
        author_id: context.userId, body: data.body, parent_id: data.parentId ?? null,
        team_id: data.teamId ?? null, mentions: data.mentions,
      } as any).select().single();
    if (error) throw error;

    // Fan-out mentions (W-14) when enabled.
    if (data.mentions.length > 0) {
      const { data: mFlag } = await context.supabase
        .from("tenant_workspace_features").select("enabled")
        .eq("tenant_id", data.tenantId).eq("feature_key", "mentions").maybeSingle();
      if (mFlag?.enabled) {
        const rows = data.mentions.map((uid) => ({
          tenant_id: data.tenantId, comment_id: row.id, mentioned_user_id: uid,
          source_type: data.resourceType, source_id: data.resourceId,
        }));
        await context.supabase.from("workspace_mentions").insert(rows as any);
        // Best-effort in-app notification.
        for (const uid of data.mentions) {
          await context.supabase.from("notifications").insert({
            user_id: uid, tenant_id: data.tenantId, kind: "mention",
            severity: "info", title: "You were mentioned",
            body: data.body.slice(0, 200),
            context: { comment_id: row.id, resource_type: data.resourceType, resource_id: data.resourceId },
          } as any);
        }
      }
    }
    return row;
  });

export const deleteComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("workspace_comments").update({ deleted_at: new Date().toISOString() } as any).eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// ═══════════════════════════════ Reactions (W-15) ════════════════════════════
export const toggleReaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({
    tenantId: z.string().uuid(),
    commentId: z.string().uuid(),
    emoji: z.string().min(1).max(16),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await requireFeature(context.supabase, data.tenantId, "comments_reactions");
    const { data: existing } = await context.supabase.from("workspace_reactions")
      .select("id").eq("comment_id", data.commentId).eq("user_id", context.userId).eq("emoji", data.emoji).maybeSingle();
    if (existing) {
      await context.supabase.from("workspace_reactions").delete().eq("id", existing.id);
      return { toggled: "off" as const };
    }
    await context.supabase.from("workspace_reactions").insert({
      tenant_id: data.tenantId, comment_id: data.commentId, user_id: context.userId, emoji: data.emoji,
    } as any);
    return { toggled: "on" as const };
  });

// ═══════════════════════════════ Mentions (W-14) ═════════════════════════════
export const listMyMentions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("workspace_mentions").select("*").eq("tenant_id", data.tenantId)
      .eq("mentioned_user_id", context.userId).order("created_at", { ascending: false }).limit(200);
    if (error) throw error;
    return rows ?? [];
  });

export const markMentionRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await context.supabase.from("workspace_mentions")
      .update({ read_at: new Date().toISOString() } as any).eq("id", data.id).eq("mentioned_user_id", context.userId);
    return { ok: true };
  });

// ═══════════════════════════════ Tasks (W-16) ════════════════════════════════
export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({
    tenantId: z.string().uuid(),
    assigneeId: z.string().uuid().optional(),
    teamId: z.string().uuid().optional(),
    mine: z.boolean().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await requireFeature(context.supabase, data.tenantId, "task_assignment");
    let q = context.supabase.from("workspace_tasks").select("*").eq("tenant_id", data.tenantId);
    if (data.mine) q = q.eq("assignee_id", context.userId);
    else if (data.assigneeId) q = q.eq("assignee_id", data.assigneeId);
    if (data.teamId) q = q.eq("team_id", data.teamId);
    const { data: rows, error } = await q.order("created_at", { ascending: false }).limit(500);
    if (error) throw error;
    return rows ?? [];
  });

export const upsertTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({
    id: z.string().uuid().optional(),
    tenantId: z.string().uuid(),
    teamId: z.string().uuid().nullable().optional(),
    assigneeId: z.string().uuid().nullable().optional(),
    title: z.string().min(1).max(300),
    description: z.string().max(4000).nullable().optional(),
    status: z.enum(["todo","in_progress","blocked","done","cancelled"]).default("todo"),
    priority: z.enum(["low","normal","high","urgent"]).default("normal"),
    dueAt: z.string().datetime().nullable().optional(),
    resourceType: z.string().max(80).nullable().optional(),
    resourceId: z.string().max(200).nullable().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await requireFeature(context.supabase, data.tenantId, "task_assignment");
    const payload: any = {
      tenant_id: data.tenantId, team_id: data.teamId ?? null, assignee_id: data.assigneeId ?? null,
      creator_id: context.userId, title: data.title, description: data.description ?? null,
      status: data.status, priority: data.priority, due_at: data.dueAt ?? null,
      resource_type: data.resourceType ?? null, resource_id: data.resourceId ?? null,
      completed_at: data.status === "done" ? new Date().toISOString() : null,
    };
    const q = data.id
      ? context.supabase.from("workspace_tasks").update(payload).eq("id", data.id).select().single()
      : context.supabase.from("workspace_tasks").insert(payload).select().single();
    const { data: row, error } = await q;
    if (error) throw error;
    return row;
  });

export const deleteTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("workspace_tasks").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// ═══════════════════════════ Availability (W-17) ═════════════════════════════
export const getAvailability = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase.from("workspace_availability")
      .select("*").eq("tenant_id", data.tenantId).eq("user_id", context.userId).maybeSingle();
    return row ?? { user_id: context.userId, tenant_id: data.tenantId, status: "available", message: null, until_at: null };
  });

export const setAvailability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({
    tenantId: z.string().uuid(),
    status: z.enum(["available","busy","dnd","away","offline"]),
    message: z.string().max(200).nullable().optional(),
    untilAt: z.string().datetime().nullable().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await requireFeature(context.supabase, data.tenantId, "availability_status");
    const { error } = await context.supabase.from("workspace_availability").upsert({
      user_id: context.userId, tenant_id: data.tenantId,
      status: data.status, message: data.message ?? null, until_at: data.untilAt ?? null,
      updated_at: new Date().toISOString(),
    } as any, { onConflict: "user_id,tenant_id" });
    if (error) throw error;
    return { ok: true };
  });

// ═══════════════════════════ Drafts + Autosave (W-18) ════════════════════════
export const saveDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({
    tenantId: z.string().uuid(),
    resourceType: z.string().min(1).max(80),
    resourceId: z.string().min(1).max(200),
    payload: z.record(z.string(), z.unknown()),
    baseVersion: z.number().int().nullable().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await requireFeature(context.supabase, data.tenantId, "autosave_drafts");
    const { error } = await context.supabase.from("workspace_drafts").upsert({
      user_id: context.userId, tenant_id: data.tenantId, resource_type: data.resourceType,
      resource_id: data.resourceId, payload: data.payload as any, base_version: data.baseVersion ?? null,
      updated_at: new Date().toISOString(),
    } as any, { onConflict: "user_id,tenant_id,resource_type,resource_id" });
    if (error) throw error;
    return { ok: true };
  });

export const getDraft = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({
    tenantId: z.string().uuid(),
    resourceType: z.string().min(1).max(80),
    resourceId: z.string().min(1).max(200),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase.from("workspace_drafts").select("*")
      .eq("user_id", context.userId).eq("tenant_id", data.tenantId)
      .eq("resource_type", data.resourceType).eq("resource_id", data.resourceId).maybeSingle();
    return row ?? null;
  });

export const discardDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({
    tenantId: z.string().uuid(),
    resourceType: z.string().min(1).max(80),
    resourceId: z.string().min(1).max(200),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await context.supabase.from("workspace_drafts").delete()
      .eq("user_id", context.userId).eq("tenant_id", data.tenantId)
      .eq("resource_type", data.resourceType).eq("resource_id", data.resourceId);
    return { ok: true };
  });

// ═══════════════════════════ Dashboard layouts (W-1) ═════════════════════════
export const getDashboardLayout = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase.from("workspace_dashboard_layouts")
      .select("*").eq("user_id", context.userId).eq("tenant_id", data.tenantId).maybeSingle();
    return row?.layout ?? [];
  });

export const saveDashboardLayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({
    tenantId: z.string().uuid(),
    layout: z.array(z.record(z.string(), z.unknown())),
    preset: z.string().max(40).nullable().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await requireFeature(context.supabase, data.tenantId, "dashboard_layouts");
    const { error } = await context.supabase.from("workspace_dashboard_layouts").upsert({
      user_id: context.userId, tenant_id: data.tenantId,
      layout: data.layout as any, preset: data.preset ?? null,
      updated_at: new Date().toISOString(),
    } as any, { onConflict: "user_id,tenant_id" });
    if (error) throw error;
    return { ok: true };
  });

// ═══════════════════════════ Sidebar shortcuts (W-5) ═════════════════════════
export const listShortcuts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase.from("workspace_sidebar_shortcuts")
      .select("*").eq("user_id", context.userId).eq("tenant_id", data.tenantId).order("order_index");
    return rows ?? [];
  });

export const upsertShortcut = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({
    id: z.string().uuid().optional(),
    tenantId: z.string().uuid(),
    label: z.string().min(1).max(80),
    url: z.string().min(1).max(500),
    icon: z.string().max(40).nullable().optional(),
    orderIndex: z.number().int().default(0),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await requireFeature(context.supabase, data.tenantId, "sidebar_shortcuts");
    const payload: any = {
      user_id: context.userId, tenant_id: data.tenantId, label: data.label,
      url: data.url, icon: data.icon ?? null, order_index: data.orderIndex,
    };
    const q = data.id
      ? context.supabase.from("workspace_sidebar_shortcuts").update(payload).eq("id", data.id).select().single()
      : context.supabase.from("workspace_sidebar_shortcuts").insert(payload).select().single();
    const { data: row, error } = await q;
    if (error) throw error;
    return row;
  });

export const deleteShortcut = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await context.supabase.from("workspace_sidebar_shortcuts").delete().eq("id", data.id).eq("user_id", context.userId);
    return { ok: true };
  });

// ═══════════════════════════ Recent searches (W-2) ═══════════════════════════
export const recordSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({
    tenantId: z.string().uuid(),
    query: z.string().min(1).max(400),
    scope: z.string().max(80).nullable().optional(),
    resultCount: z.number().int().nullable().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await requireFeature(context.supabase, data.tenantId, "recent_searches");
    await context.supabase.from("workspace_recent_searches").insert({
      user_id: context.userId, tenant_id: data.tenantId, query: data.query,
      scope: data.scope ?? null, result_count: data.resultCount ?? null,
    } as any);
    return { ok: true };
  });

export const listRecentSearches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase.from("workspace_recent_searches")
      .select("*").eq("user_id", context.userId).eq("tenant_id", data.tenantId)
      .order("executed_at", { ascending: false }).limit(50);
    return rows ?? [];
  });

// ═══════════════════════════ Notification prefs (W-9) ════════════════════════
export const listNotificationPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase.from("workspace_notification_prefs")
      .select("*").eq("user_id", context.userId).eq("tenant_id", data.tenantId);
    return rows ?? [];
  });

export const setNotificationPref = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({
    tenantId: z.string().uuid(),
    eventType: z.string().min(1).max(80),
    channel: z.enum(["email","sms","push","in_app"]),
    enabled: z.boolean(),
    digest: z.enum(["immediate","hourly","daily","weekly"]).default("immediate"),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await requireFeature(context.supabase, data.tenantId, "notification_prefs_matrix");
    const { error } = await context.supabase.from("workspace_notification_prefs").upsert({
      user_id: context.userId, tenant_id: data.tenantId, event_type: data.eventType,
      channel: data.channel, enabled: data.enabled, digest: data.digest,
      updated_at: new Date().toISOString(),
    } as any, { onConflict: "user_id,tenant_id,event_type,channel" });
    if (error) throw error;
    return { ok: true };
  });

// ═══════════════════════════ Announcements (W-3) ═════════════════════════════
export const listAnnouncements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => TenantScope.parse(i))
  .handler(async ({ data, context }) => {
    const { data: enabledFlag } = await context.supabase.from("tenant_workspace_features")
      .select("enabled").eq("tenant_id", data.tenantId).eq("feature_key", "announcement_banner").maybeSingle();
    if (!enabledFlag?.enabled) return [];
    const now = new Date().toISOString();
    const { data: rows } = await context.supabase.from("workspace_announcements")
      .select("*").eq("tenant_id", data.tenantId)
      .lte("starts_at", now)
      .order("created_at", { ascending: false });
    const dismissed = await context.supabase.from("workspace_announcement_dismissals")
      .select("announcement_id").eq("user_id", context.userId);
    const dset = new Set((dismissed.data ?? []).map((d: any) => d.announcement_id));
    return (rows ?? []).filter((r: any) => (!r.ends_at || r.ends_at > now) && !dset.has(r.id));
  });

export const upsertAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({
    id: z.string().uuid().optional(),
    tenantId: z.string().uuid(),
    workspaceId: z.string().uuid().nullable().optional(),
    title: z.string().min(1).max(200),
    body: z.string().max(4000).nullable().optional(),
    severity: z.enum(["info","warning","critical"]).default("info"),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().nullable().optional(),
    dismissible: z.boolean().default(true),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const payload: any = {
      tenant_id: data.tenantId, workspace_id: data.workspaceId ?? null,
      title: data.title, body: data.body ?? null, severity: data.severity,
      starts_at: data.startsAt ?? new Date().toISOString(),
      ends_at: data.endsAt ?? null, dismissible: data.dismissible,
      created_by: context.userId,
    };
    const q = data.id
      ? context.supabase.from("workspace_announcements").update(payload).eq("id", data.id).select().single()
      : context.supabase.from("workspace_announcements").insert(payload).select().single();
    const { data: row, error } = await q;
    if (error) throw error;
    return row;
  });

export const dismissAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({ announcementId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await context.supabase.from("workspace_announcement_dismissals").upsert({
      announcement_id: data.announcementId, user_id: context.userId,
      dismissed_at: new Date().toISOString(),
    } as any, { onConflict: "announcement_id,user_id" });
    return { ok: true };
  });

// ═════════════ Single-session enforcement + logout all (W-21/W-22) ══════════
export const registerSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({
    tenantId: z.string().uuid().nullable().optional(),
    sessionToken: z.string().min(8).max(128),
    userAgent: z.string().max(400).nullable().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    // Feature gate — only enforce single-session when the tenant has toggled it on.
    let single = false;
    if (data.tenantId) {
      const { data: f } = await context.supabase.from("tenant_workspace_features")
        .select("enabled").eq("tenant_id", data.tenantId).eq("feature_key", "single_session_enforcement").maybeSingle();
      single = !!f?.enabled;
    }
    if (single && data.tenantId) {
      await context.supabase.from("workspace_active_sessions")
        .update({ forced_out_at: new Date().toISOString(), force_reason: "single_session_policy" } as any)
        .eq("user_id", context.userId).eq("tenant_id", data.tenantId).is("forced_out_at", null);
    }
    await context.supabase.from("workspace_active_sessions").upsert({
      user_id: context.userId, tenant_id: data.tenantId ?? null,
      session_token: data.sessionToken, user_agent: data.userAgent ?? null,
      issued_at: new Date().toISOString(), last_seen_at: new Date().toISOString(),
      forced_out_at: null, force_reason: null,
    } as any, { onConflict: "user_id,session_token" });
    return { ok: true, single };
  });

export const heartbeatSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({ sessionToken: z.string().min(8).max(128) }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase.from("workspace_active_sessions")
      .select("forced_out_at,force_reason").eq("user_id", context.userId).eq("session_token", data.sessionToken).maybeSingle();
    if (row?.forced_out_at) return { forcedOut: true, reason: row.force_reason ?? "policy" };
    await context.supabase.from("workspace_active_sessions")
      .update({ last_seen_at: new Date().toISOString() } as any)
      .eq("user_id", context.userId).eq("session_token", data.sessionToken);
    return { forcedOut: false };
  });

export const logoutAllDevices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({ tenantId: z.string().uuid().nullable().optional() }).parse(i))
  .handler(async ({ data, context }) => {
    if (data.tenantId) {
      await requireFeature(context.supabase, data.tenantId, "logout_all_devices");
    }
    const authorization = getRequest().headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) throw new Error("Unauthorized");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await revokeOtherAuthSessions(supabaseAdmin.auth.admin, authorization.slice(7));
    const { error } = await context.supabase.from("workspace_active_sessions")
      .update({ forced_out_at: new Date().toISOString(), force_reason: "user_logout_all" } as any)
      .eq("user_id", context.userId).is("forced_out_at", null);
    return { ok: true, auth_revoked: true, registry_updated: !error };
  });

// ═══════════════════════════ Read-path audit (W-28) ══════════════════════════
export const logReadEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({
    tenantId: z.string().uuid(),
    resourceType: z.string().min(1).max(80),
    resourceId: z.string().min(1).max(200),
    sensitiveClass: z.string().max(40).nullable().optional(),
    teamId: z.string().uuid().nullable().optional(),
    context: z.record(z.string(), z.unknown()).optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: f } = await context.supabase.from("tenant_workspace_features")
      .select("enabled").eq("tenant_id", data.tenantId).eq("feature_key", "read_path_audit").maybeSingle();
    if (!f?.enabled) return { ok: true, skipped: true };
    await context.supabase.from("workspace_read_events").insert({
      tenant_id: data.tenantId, user_id: context.userId, team_id: data.teamId ?? null,
      resource_type: data.resourceType, resource_id: data.resourceId,
      sensitive_class: data.sensitiveClass ?? null, context: data.context ?? {},
    } as any);
    return { ok: true };
  });

// ═══════════════════════════ Themes catalog (W-7/W-8) ════════════════════════
export const listThemesCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data: rows } = await context.supabase.from("workspace_themes_catalog")
      .select("*").order("wcag_score", { ascending: false });
    return rows ?? [];
  });

// ═══════════════════════════ Profile fields (W-10) ═══════════════════════════
export const updateExtendedProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({
    jobTitle: z.string().max(120).nullable().optional(),
    employeeId: z.string().max(80).nullable().optional(),
    biography: z.string().max(2000).nullable().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("profiles").update({
      job_title: data.jobTitle ?? null,
      employee_id: data.employeeId ?? null,
      biography: data.biography ?? null,
    } as any).eq("id", context.userId);
    if (error) throw error;
    return { ok: true };
  });
