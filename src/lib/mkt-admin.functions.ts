import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { classifyMarketingUsageCost } from "@/lib/mkt-llm-cost";
import { hasAnyMktRole, MKT_ANALYTICS_ROLES, MKT_TAB_ROLES, type MktRole as SharedMktRole } from "./mkt-admin-roles";

export const mktRoles = z.enum(["super_admin","sales_admin","marketing_admin","ai_admin","brand_reviewer","brand_publisher"]);
export type MktRole = z.infer<typeof mktRoles>;

/**
 * Server-side authorization gate for Site management (and other) admin
 * handlers. Reads the caller's roles from `mkt_admin_roles` using the
 * RLS-scoped `context.supabase` client and throws a 403 Response when the
 * caller lacks every allowed role. `super_admin` always passes. Use this at
 * the top of every handler that mutates or reads tenant-privileged data.
 */
/** Platform admin bypass — Platform Owners transparently pass every mkt gate. */
async function isPlatformAdminCtx(ctx: { supabase: any; userId: string }): Promise<boolean> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const { data } = await ctx.supabase.rpc("is_platform_admin", { _user_id: ctx.userId });
    return Boolean(data);
  } catch { return false; }
}

export async function assertMktRole(
  context: { supabase: any; userId: string }, // eslint-disable-line @typescript-eslint/no-explicit-any
  allowed: readonly SharedMktRole[],
): Promise<SharedMktRole[]> {
  const { data, error } = await context.supabase
    .from("mkt_admin_roles").select("role").eq("user_id", context.userId);
  if (error) throw new Response("Forbidden", { status: 403 });
  const roles = ((data ?? []) as { role: string }[]).map((r) => r.role as SharedMktRole);
  if (hasAnyMktRole(roles, allowed)) return roles;
  // Platform admin bypass: Platform Owners implicitly hold every mkt role.
  if (await isPlatformAdminCtx(context)) return ["super_admin", ...roles] as SharedMktRole[];
  throw new Response("Forbidden", { status: 403 });
}


/** Server fn wrapper — used by route beforeLoad guards to gate a tab. */
export const assertMktRolesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ allowed: z.array(mktRoles).min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMktRole(context, data.allowed);
    return { ok: true };
  });

/** Roles held by the currently authenticated user. Platform admins receive
 * an implicit `super_admin` so the marketing surfaces open without an
 * additional grant. Returns [] for non-admins. */
export const myMktRoles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("mkt_admin_roles").select("role").eq("user_id", context.userId);
    const roles = error ? [] : (data ?? []).map((r) => r.role as MktRole);
    if (await isPlatformAdminCtx(context) && !roles.includes("super_admin")) {
      return ["super_admin", ...roles] as MktRole[];
    }
    return roles;
  });

/** Platform admin self-grant: materialize a real `super_admin` row so the
 * caller shows up in mkt_admin_users / audit trails. Idempotent. */
export const platformAdminSelfGrantMkt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    if (!(await isPlatformAdminCtx(context))) throw new Response("Forbidden", { status: 403 });
    const email = (context.claims as { email?: string } | undefined)?.email ?? null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("mkt_admin_users").upsert(
      { user_id: context.userId, display_name: email ?? context.userId, status: "active" },
      { onConflict: "user_id" } as never,
    );
    const { error } = await supabaseAdmin.from("mkt_admin_roles").insert({
      user_id: context.userId, role: "super_admin", granted_by: context.userId,
    });
    if (error && !/duplicate/i.test(error.message)) throw new Error(error.message);
    const { logMktChange, resolveMktActorContext } = await import("./mkt-audit.server");
    const actor = await resolveMktActorContext(context, { source: "platform_admin_self_grant" });
    await logMktChange({
      entity_type: "admin_role",
      entity_key: `${context.userId}:super_admin`,
      action: "create",
      actor_id: context.userId,
      actor_email: email,
      actor_context: actor,
      before: null,
      after: { user_id: context.userId, role: "super_admin", via: "platform_admin_self_grant" } as never,
      summary: `Platform admin self-granted mkt super_admin (${email ?? context.userId})`,
    });
    return { ok: true };
  });





/** Bootstrap: if no super_admin exists yet, promote current user.
 * Atomic via SECURITY DEFINER RPC (`mkt_bootstrap_super_admin`) which
 * takes a transaction advisory lock so two operators cannot race.
 * Every attempt — success or denial — is written to the audit log. */
export const bootstrapSuperAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = (context.claims as { email?: string } | undefined)?.email ?? null;
    const { logMktChange, resolveMktActorContext } = await import("./mkt-audit.server");
    const actor = await resolveMktActorContext(context, { source: "bootstrap_super_admin" });
    const { data, error } = await supabaseAdmin.rpc("mkt_bootstrap_super_admin" as never, {
      _caller: context.userId, _email: email,
    } as never);
    if (error) {
      await logMktChange({
        entity_type: "mkt_bootstrap",
        entity_key: context.userId,
        action: "bootstrap_denied",
        actor_id: context.userId,
        actor_email: email,
        actor_context: actor,
        after: { error: error.message } as never,
        summary: `Bootstrap attempt failed: ${error.message}`,
      });
      throw new Error(error.message);
    }
    const row = (Array.isArray(data) ? data[0] : data) as { promoted: boolean; reason: string } | null;
    const promoted = Boolean(row?.promoted);
    await logMktChange({
      entity_type: "mkt_bootstrap",
      entity_key: context.userId,
      action: promoted ? "bootstrap_success" : "bootstrap_denied",
      actor_id: context.userId,
      actor_email: email,
      actor_context: actor,
      after: { reason: row?.reason ?? "unknown" } as never,
      summary: promoted
        ? `Bootstrapped super_admin for ${email ?? context.userId}`
        : `Bootstrap denied: ${row?.reason ?? "unknown"}`,
    });
    return { promoted, reason: row?.reason ?? "unknown" };
  });

export const listMktAdmins = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("mkt_admin_roles")
      .select("user_id,role,granted_at,mkt_admin_users(display_name,status)");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const grantMktRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ user_id: z.string().uuid(), role: mktRoles }).parse(d))
  .handler(async ({ data, context }) => {
    const effectiveRoles = await assertMktRole(context, ["super_admin"]);
    const { requireMktStepUp } = await import("./mkt-stepup.server");
    await requireMktStepUp(context, {
      entity_type: "admin_role", entity_key: `${data.user_id}:${data.role}`, action: "create",
      summary: `Step-up for grantMktRole ${data.role}`,
    });
    const { error } = await context.supabase.from("mkt_admin_roles")
      .insert({ user_id: data.user_id, role: data.role, granted_by: context.userId });
    if (error && !/duplicate/i.test(error.message)) throw new Error(error.message);
    const { logMktChange, resolveMktActorContext } = await import("./mkt-audit.server");
    const actor = await resolveMktActorContext(context, { roles: effectiveRoles, source: "assertMktRole:super_admin+stepup" });
    // Snapshot the target user's roles BEFORE + AFTER so audit reviewers can
    // see the effective permission set the grant produced for the grantee.
    const { data: targetAfter } = await context.supabase.from("mkt_admin_roles")
      .select("role").eq("user_id", data.user_id);
    const targetRoles = ((targetAfter ?? []) as { role: string }[]).map((r) => r.role);
    await logMktChange({
      entity_type: "admin_role",
      entity_key: `${data.user_id}:${data.role}`,
      action: "create",
      actor_id: context.userId,
      actor_email: actor.email,
      actor_context: actor,
      before: null,
      after: { user_id: data.user_id, role: data.role, target_effective_roles: targetRoles } as never,
      summary: `Granted role "${data.role}" to user ${data.user_id} (effective roles: ${targetRoles.join(", ") || "none"})`,
    });
    return { ok: true };
  });

export const revokeMktRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ user_id: z.string().uuid(), role: mktRoles }).parse(d))
  .handler(async ({ data, context }) => {
    const effectiveRoles = await assertMktRole(context, ["super_admin"]);
    const { requireMktStepUp } = await import("./mkt-stepup.server");
    await requireMktStepUp(context, {
      entity_type: "admin_role", entity_key: `${data.user_id}:${data.role}`, action: "delete",
      summary: `Step-up for revokeMktRole ${data.role}`,
    });
    // Capture the target's roles BEFORE deletion so the audit row records
    // the effective permission set the revoke removed from.
    const { data: targetBefore } = await context.supabase.from("mkt_admin_roles")
      .select("role").eq("user_id", data.user_id);
    const beforeRoles = ((targetBefore ?? []) as { role: string }[]).map((r) => r.role);
    const { error } = await context.supabase.from("mkt_admin_roles")
      .delete().eq("user_id", data.user_id).eq("role", data.role);
    if (error) throw new Error(error.message);
    const { data: targetAfter } = await context.supabase.from("mkt_admin_roles")
      .select("role").eq("user_id", data.user_id);
    const afterRoles = ((targetAfter ?? []) as { role: string }[]).map((r) => r.role);
    const { logMktChange, resolveMktActorContext } = await import("./mkt-audit.server");
    const actor = await resolveMktActorContext(context, { roles: effectiveRoles, source: "assertMktRole:super_admin+stepup" });
    await logMktChange({
      entity_type: "admin_role",
      entity_key: `${data.user_id}:${data.role}`,
      action: "delete",
      actor_id: context.userId,
      actor_email: actor.email,
      actor_context: actor,
      before: { user_id: data.user_id, role: data.role, target_effective_roles: beforeRoles } as never,
      after: { user_id: data.user_id, remaining_effective_roles: afterRoles } as never,
      summary: `Revoked role "${data.role}" from user ${data.user_id} (remaining: ${afterRoles.join(", ") || "none"})`,
    });
    return { ok: true };
  });

/* ---------------- KB Sources ---------------- */

export const listKbSources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("mkt_kb_sources")
      .select("id,title,type,version,status,tags,created_at").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertKbSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    id: z.string().uuid().optional(),
    title: z.string().min(1).max(200),
    type: z.enum(["pdf","docx","pptx","faq","md","url","text"]),
    source_url: z.string().url().optional().nullable(),
    tags: z.array(z.string()).default([]),
    content: z.string().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    let before: unknown = null;
    if (data.id) {
      const { data: existing } = await context.supabase.from("mkt_kb_sources")
        .select("id,title,type,source_url,tags,status").eq("id", data.id).maybeSingle();
      before = existing ?? null;
    }
    const { data: row, error } = await context.supabase.from("mkt_kb_sources")
      .upsert({
        id: data.id, title: data.title, type: data.type,
        source_url: data.source_url ?? null, tags: data.tags,
        created_by: context.userId, status: "active",
      }).select("id").single();
    if (error) throw new Error(error.message);

    if (data.content && data.content.trim().length > 0) {
      // naive chunker: 800 chars w/ 100 overlap
      const chunks: string[] = [];
      const src = data.content;
      const size = 800, overlap = 100;
      for (let i = 0; i < src.length; i += size - overlap) chunks.push(src.slice(i, i + size));
      await context.supabase.from("mkt_kb_chunks").delete().eq("source_id", row.id);
      await context.supabase.from("mkt_kb_chunks").insert(chunks.map((c, ix) => ({
        source_id: row.id, chunk_ix: ix, content: c, metadata: { title: data.title },
      })));
    }
    const { logMktChange } = await import("./mkt-audit.server");
    await logMktChange({
      entity_type: "kb_source",
      entity_key: row.id,
      action: before ? "update" : "create",
      actor_id: context.userId,
      actor_email: (context.claims as { email?: string } | undefined)?.email ?? null,
      before: before as never,
      after: { id: row.id, title: data.title, type: data.type, source_url: data.source_url ?? null, tags: data.tags, has_content: Boolean(data.content) } as never,
      summary: `${before ? "Updated" : "Created"} knowledge source "${data.title}"`,
    });
    return { id: row.id };
  });

/* ---------------- LLM providers ---------------- */

export const listLlmProviders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("mkt_llm_providers")
      .select("*").order("priority", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertLlmProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    id: z.string().uuid().optional(),
    provider: z.enum(["byok","azure_muse","muse","anthropic","google","mistral","groq","openrouter"]),
    display_name: z.string().min(1).max(80),
    base_url: z.string().url().optional().nullable(),
    default_model: z.string().max(120).optional().nullable(),
    api_key_ref: z.string().max(120).optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
    enabled: z.boolean().default(true),
    priority: z.number().int().min(0).max(1000).default(100),
  }).parse(d))
  .handler(async ({ data, context }) => {
    let before: unknown = null;
    if (data.id) {
      const { data: existing } = await context.supabase.from("mkt_llm_providers")
        .select("*").eq("id", data.id).maybeSingle();
      before = existing ?? null;
    }
    const { data: row, error } = await context.supabase.from("mkt_llm_providers")
      .upsert(data).select("id").single();
    if (error) throw new Error(error.message);
    const { logMktChange } = await import("./mkt-audit.server");
    await logMktChange({
      entity_type: "llm_provider",
      entity_key: row.id,
      action: before ? "update" : "create",
      actor_id: context.userId,
      actor_email: (context.claims as { email?: string } | undefined)?.email ?? null,
      before: before as never,
      after: { ...data, id: row.id, api_key_ref: data.api_key_ref ? "[set]" : null } as never,
      summary: `${before ? "Updated" : "Created"} LLM provider "${data.display_name}"`,
    });
    return { id: row.id };
  });

/* ---------------- Chat analytics (PII-safe aggregate only) ---------------- */

/**
 * Server-side authorization gate that asserts the caller holds at least one of
 * the supplied mkt roles AND throws a 403 when they do not. Mirrors
 * `assertMktRole` but enforces role-only (mkt) gating — used by the aggregate
 * RPC handlers that AI admin roles may still call but only receive
 * small-cell-suppressed counts from. The mkt_lead_kpis / mkt_chat_kpis /
 * mkt_cta_analytics / mkt_llm_usage_stats SECURITY DEFINER functions enforce
 * their own row-level read boundary inside Postgres.
 */
export async function assertMktRoleAssignment(
  context: { supabase: any; userId: string }, // eslint-disable-line @typescript-eslint/no-explicit-any
  allowed: readonly SharedMktRole[],
): Promise<SharedMktRole[]> {
  const { data, error } = await context.supabase
    .from("mkt_admin_roles").select("role").eq("user_id", context.userId);
  if (error) throw new Response("Forbidden", { status: 403 });
  const roles = ((data ?? []) as { role: string }[]).map((r) => r.role as SharedMktRole);
  if (hasAnyMktRole(roles, allowed)) return roles;
  if (await isPlatformAdminCtx(context)) return ["super_admin", ...roles] as SharedMktRole[];
  throw new Response("Forbidden", { status: 403 });
}

export const chatKpis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertMktRoleAssignment(context, MKT_ANALYTICS_ROLES);
    const aggregateClient = context.supabase as unknown as {
      rpc: (name: "mkt_chat_kpis") => PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
    const { data, error } = await aggregateClient.rpc("mkt_chat_kpis");
    if (error) throw new Error(error.message);
    return data as {
      restricted: boolean;
      totalSessions: number | null;
      escalated: number | null;
      escalationRate: number | null;
      csat: number | null;
      totalCost: number | null;
      totalTokens: number | null;
      totalMessages: number | null;
    };
  });

/** CTA analytics: small-cell-suppressed aggregate RPC. */
export const getMktCtaAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ days: z.number().int().min(1).max(90).default(30) }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await assertMktRoleAssignment(context, MKT_ANALYTICS_ROLES);
    const aggregateClient = context.supabase as unknown as {
      rpc: (name: "mkt_cta_analytics", args: { _days: number }) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
    const { data: rows, error } = await aggregateClient.rpc("mkt_cta_analytics", { _days: data.days });
    if (error) throw new Error(error.message);
    return rows as {
      restricted: boolean;
      totals: Record<string, number | null>;
      byCta: Array<{ cta_id: string; view: number | null; click: number | null; form_submit: number | null; pack_download: number | null }>;
      bySource: Array<{ source: string; total: number }>;
      byRegion: Array<{ region: string; total: number }>;
      recent: Array<{ day: string; event_type: string; total: number }>;
    };
  });
