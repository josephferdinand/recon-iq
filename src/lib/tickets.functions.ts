import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const TICKET_CATEGORIES = [
  "general_question",
  "bug",
  "feature_request",
  "design_feedback",
  "data_quality",
  "integration",
  "access_permissions",
  "billing",
  "security_concern",
  "compliance",
  "performance",
  "training",
  "documentation",
  "incident",
  "other",
] as const;

const scopeEnum = z.enum(["workspace", "tenant", "platform"]);
const priorityEnum = z.enum(["low", "normal", "high", "urgent"]);
const statusEnum = z.enum(["open", "in_progress", "waiting_customer", "resolved", "closed"]);
const categoryEnum = z.enum(TICKET_CATEGORIES);

const attachmentSchema = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().nonnegative().optional(),
  type: z.string().max(120).optional(),
  data_url: z.string().max(2_000_000).optional(),
  url: z.string().url().optional(),
});

/**
 * List tickets — RLS-enforced. Mirrors the copilot `list_support_tickets`
 * filter contract so the UI and the copilot command produce identical results.
 * Returns SLA policy join + timestamps so the client can render countdown
 * badges and pending-action summaries without additional round-trips.
 */
export const listTickets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid().optional(),
      scope: scopeEnum.optional(),
      queue: z.enum(["tenant", "platform"]).optional(),
      status: statusEnum.optional(),
      priority: priorityEnum.optional(),
      category: categoryEnum.optional(),
      assignee_id: z.string().uuid().optional(),
      created_by: z.string().uuid().optional(),
      sla_state: z.enum(["breached", "due_soon", "on_track", "any"]).default("any"),
      query: z.string().trim().min(1).max(120).optional(),
      mine: z.boolean().default(false),
      limit: z.number().int().min(1).max(500).default(300),
    }).parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("support_tickets")
      .select(
        "id, ref, subject, priority, status, queue, scope, category, tenant_id, recon_id, created_by, assignee_id, escalated_at, first_response_at, resolved_at, closed_at, created_at, updated_at, sla_policies:sla_policy_id(first_response_mins, resolution_mins, name)",
      )
      .order("created_at", { ascending: false }).limit(data.limit);
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    if (data.scope) q = q.eq("scope", data.scope);
    if (data.queue) q = q.eq("queue", data.queue);
    if (data.status) q = q.eq("status", data.status);
    if (data.priority) q = q.eq("priority", data.priority);
    if (data.category) q = q.eq("category", data.category);
    if (data.assignee_id) q = q.eq("assignee_id", data.assignee_id);
    if (data.created_by) q = q.eq("created_by", data.created_by);
    if (data.mine) q = q.eq("created_by", context.userId);
    if (data.query)
      q = q.or(`subject.ilike.%${data.query}%,ref.ilike.%${data.query.toUpperCase()}%`);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const enriched = (rows ?? []).map((r: any) => ({ ...r, sla: computeSlaState(r) }));
    const withPeople = await enrichWithPeopleAndTenants(enriched);
    if (data.sla_state === "any") return withPeople;
    return withPeople.filter((r: any) => {
      if (data.sla_state === "breached") return r.sla.resolution_status === "breached";
      if (data.sla_state === "due_soon")
        return r.sla.resolution_status === "pending" &&
          (r.sla.minutes_to_resolution_due ?? Infinity) <= 60;
      if (data.sla_state === "on_track")
        return r.sla.resolution_status === "pending" &&
          (r.sla.minutes_to_resolution_due ?? 0) > 60;
      return true;
    });
  });

/**
 * Distinct filter facets scoped to what the caller can actually see. RLS on
 * support_tickets does the enforcement; this fn just projects the visible
 * tenant/creator/assignee sets for the filter dropdowns. Safe to expose the
 * profile display info because the tickets themselves are already visible.
 */
export const listTicketFilterOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid().optional(),
      scope: scopeEnum.optional(),
    }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("support_tickets")
      .select("tenant_id, created_by, assignee_id, scope")
      .limit(5000);
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    if (data.scope) q = q.eq("scope", data.scope);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const tenantIds = new Set<string>();
    const userIds = new Set<string>();
    for (const r of (rows ?? []) as any[]) {
      if (r.tenant_id) tenantIds.add(r.tenant_id);
      if (r.created_by) userIds.add(r.created_by);
      if (r.assignee_id) userIds.add(r.assignee_id);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [tenantsRes, profilesRes] = await Promise.all([
      tenantIds.size
        ? supabaseAdmin.from("tenants").select("id, slug, name").in("id", Array.from(tenantIds))
        : Promise.resolve({ data: [] as any[] }),
      userIds.size
        ? supabaseAdmin.from("profiles").select("id, email, full_name").in("id", Array.from(userIds))
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const profileMap = new Map<string, any>((profilesRes.data ?? []).map((p: any) => [p.id, p]));
    const creators = new Set<string>();
    const assignees = new Set<string>();
    for (const r of (rows ?? []) as any[]) {
      if (r.created_by) creators.add(r.created_by);
      if (r.assignee_id) assignees.add(r.assignee_id);
    }
    const toPeople = (ids: Set<string>) =>
      Array.from(ids)
        .map((id) => profileMap.get(id) ?? { id, email: null, full_name: null })
        .sort((a: any, b: any) =>
          (a.full_name ?? a.email ?? a.id).localeCompare(b.full_name ?? b.email ?? b.id),
        );
    return {
      tenants: (tenantsRes.data ?? []).sort((a: any, b: any) =>
        (a.name ?? a.slug ?? "").localeCompare(b.name ?? b.slug ?? ""),
      ),
      creators: toPeople(creators),
      assignees: toPeople(assignees),
    };
  });

/**
 * Batch-hydrate tenant name/slug and created_by/assignee profile info for
 * ticket rows. RLS already scoped which tickets the caller can see; this
 * just resolves opaque UUIDs into display names for the UI. Uses the admin
 * client because `profiles` RLS restricts non-admins to their own row.
 */
async function enrichWithPeopleAndTenants(rows: any[]): Promise<any[]> {
  if (!rows.length) return rows;
  const tenantIds = Array.from(new Set(rows.map((r) => r.tenant_id).filter(Boolean))) as string[];
  const userIds = Array.from(new Set(
    rows.flatMap((r) => [r.created_by, r.assignee_id]).filter(Boolean),
  )) as string[];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [tenantsRes, profilesRes] = await Promise.all([
    tenantIds.length
      ? supabaseAdmin.from("tenants").select("id, slug, name").in("id", tenantIds)
      : Promise.resolve({ data: [] as any[] }),
    userIds.length
      ? supabaseAdmin.from("profiles").select("id, email, full_name").in("id", userIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const tenantMap = new Map<string, any>((tenantsRes.data ?? []).map((t: any) => [t.id, t]));
  const profileMap = new Map<string, any>((profilesRes.data ?? []).map((p: any) => [p.id, p]));
  return rows.map((r) => ({
    ...r,
    tenant: r.tenant_id ? tenantMap.get(r.tenant_id) ?? null : null,
    created_by_profile: r.created_by ? profileMap.get(r.created_by) ?? null : null,
    assignee_profile: r.assignee_id ? profileMap.get(r.assignee_id) ?? null : null,
  }));
}

/**
 * Pure SLA calculator — exported for shared use by the tickets UI and any
 * copilot summary tool so the two surfaces cannot drift.
 */
export function computeSlaState(row: any): {
  first_response_due_at: string | null;
  resolution_due_at: string | null;
  first_response_status: "met" | "pending" | "breached" | "n/a";
  resolution_status: "met" | "pending" | "breached" | "n/a";
  minutes_to_resolution_due: number | null;
  pending_actions: string[];
} {
  const sla = row.sla_policies ?? row.sla ?? null;
  const pending: string[] = [];
  if (!row.assignee_id) pending.push("unassigned");
  if (!row.first_response_at && row.status !== "closed" && row.status !== "resolved")
    pending.push("no_first_response");
  if (row.status === "waiting_customer") pending.push("waiting_customer");
  if (!sla) {
    return {
      first_response_due_at: null,
      resolution_due_at: null,
      first_response_status: "n/a",
      resolution_status: "n/a",
      minutes_to_resolution_due: null,
      pending_actions: pending,
    };
  }
  const created = new Date(row.created_at).getTime();
  const frDue = new Date(created + sla.first_response_mins * 60_000);
  const rDue = new Date(created + sla.resolution_mins * 60_000);
  const now = Date.now();
  const frStatus: "met" | "pending" | "breached" = row.first_response_at
    ? "met"
    : now > frDue.getTime() ? "breached" : "pending";
  const rStatus: "met" | "pending" | "breached" =
    row.resolved_at || row.closed_at ? "met" : now > rDue.getTime() ? "breached" : "pending";
  if (frStatus === "breached") pending.push("first_response_breached");
  if (rStatus === "breached") pending.push("resolution_breached");
  return {
    first_response_due_at: frDue.toISOString(),
    resolution_due_at: rDue.toISOString(),
    first_response_status: frStatus,
    resolution_status: rStatus,
    minutes_to_resolution_due: Math.round((rDue.getTime() - now) / 60_000),
    pending_actions: pending,
  };
}

export const getTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: t, error } = await context.supabase
      .from("support_tickets").select("*").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    const { data: msgs } = await context.supabase
      .from("ticket_messages")
      .select("id, author_id, body, internal_note, created_at")
      .eq("ticket_id", data.id).order("created_at", { ascending: true });
    // Row-boundary decrypt for support_tickets.body and ticket_messages.body.
    const { maybeDecryptField } = await import("./crypto.server");
    const ticketDecrypted = t ? { ...(t as any), body: await maybeDecryptField((t as any).body) } : t;
    const messagesDecrypted = await Promise.all(
      (msgs ?? []).map(async (m: any) => ({ ...m, body: await maybeDecryptField(m.body) })),
    );
    // Hydrate tenant + created_by + assignee + message author display info.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userIds = Array.from(new Set([
      (t as any)?.created_by,
      (t as any)?.assignee_id,
      ...messagesDecrypted.map((m: any) => m.author_id),
    ].filter(Boolean))) as string[];
    const [tenantRes, profilesRes] = await Promise.all([
      (t as any)?.tenant_id
        ? supabaseAdmin.from("tenants").select("id, slug, name").eq("id", (t as any).tenant_id).maybeSingle()
        : Promise.resolve({ data: null }),
      userIds.length
        ? supabaseAdmin.from("profiles").select("id, email, full_name").in("id", userIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const profileMap = new Map<string, any>(((profilesRes as any).data ?? []).map((p: any) => [p.id, p]));
    const enrichedTicket = ticketDecrypted ? {
      ...(ticketDecrypted as any),
      tenant: (tenantRes as any).data ?? null,
      created_by_profile: profileMap.get((ticketDecrypted as any).created_by) ?? null,
      assignee_profile: (ticketDecrypted as any).assignee_id
        ? profileMap.get((ticketDecrypted as any).assignee_id) ?? null : null,
    } : ticketDecrypted;
    const enrichedMessages = messagesDecrypted.map((m: any) => ({
      ...m, author: profileMap.get(m.author_id) ?? null,
    }));
    return { ticket: enrichedTicket, messages: enrichedMessages };
  });

/**
 * Returns candidate assignees for a ticket, RBAC-scoped:
 *  - platform-scope ticket → active platform admins (via `platform_roles`).
 *  - tenant/workspace ticket → active tenant_admins for the ticket's tenant,
 *    plus platform admins (who can always take ownership).
 * Uses the admin client because `profiles` RLS restricts non-admins to their
 * own row; callers already need SELECT on the ticket (RLS-enforced) to hit
 * this endpoint via the UI.
 */
export const listAssignableUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      ticket_id: z.string().uuid().optional(),
      tenant_id: z.string().uuid().nullable().optional(),
      scope: scopeEnum.optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    // Verify caller can see the ticket (RLS) — if ticket_id supplied.
    let tenantId = data.tenant_id ?? null;
    let scope = data.scope ?? "tenant";
    if (data.ticket_id) {
      const { data: t, error } = await context.supabase
        .from("support_tickets").select("tenant_id, scope").eq("id", data.ticket_id).maybeSingle();
      if (error || !t) throw new Error("Ticket not visible");
      tenantId = (t as any).tenant_id;
      scope = (t as any).scope;
    }
    const userIds = await resolveAssignableUserIds(context, { tenant_id: tenantId, scope });
    if (!userIds.size) return [];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profiles } = await supabaseAdmin
      .from("profiles").select("id, email, full_name").in("id", Array.from(userIds));
    return (profiles ?? []).sort((a: any, b: any) =>
      (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? ""),
    );
  });
/**
 * Returns the set of user_ids who are allowed to own a ticket given its
 * scope + tenant. Shared by `listAssignableUsers` (dropdown source) and
 * `updateTicket` (server-side authorization on assignee changes). Keeping
 * a single source of truth prevents the UI drop-down and the write path
 * from drifting.
 */
async function resolveAssignableUserIds(
  ctx: { supabase: any },
  args: { tenant_id: string | null; scope: string },
): Promise<Set<string>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const ids = new Set<string>();
  const { data: plat } = await supabaseAdmin
    .from("platform_roles").select("user_id").eq("role", "platform_admin");
  (plat ?? []).forEach((r: any) => ids.add(r.user_id));
  if (args.scope !== "platform" && args.tenant_id) {
    const { data: admins } = await supabaseAdmin
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", args.tenant_id)
      .eq("role", "tenant_admin")
      .eq("active", true);
    (admins ?? []).forEach((r: any) => ids.add(r.user_id));
  }
  return ids;
}

/** Fetch a display name + email for a user id (best-effort). */
async function loadProfile(userId: string): Promise<{ id: string; email: string | null; full_name: string | null } | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("profiles").select("id, email, full_name").eq("id", userId).maybeSingle();
  return (data as any) ?? null;
}

/** Fetch tenant slug + name (best-effort). */
async function loadTenant(tenantId: string | null): Promise<{ id: string; slug: string | null; name: string | null } | null> {
  if (!tenantId) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("tenants").select("id, slug, name").eq("id", tenantId).maybeSingle();
  return (data as any) ?? null;
}


export const createTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      scope: scopeEnum.default("workspace"),
      tenant_id: z.string().uuid().nullable().optional(),
      recon_id: z.string().uuid().nullable().optional(),
      subject: z.string().trim().min(3).max(160),
      body: z.string().trim().min(3).max(8000),
      priority: priorityEnum.default("normal"),
      category: categoryEnum.default("general_question"),
      attachments: z.array(attachmentSchema).max(10).default([]),
    }).parse(d))
  .handler(async ({ data, context }) => {
    // Validate scope/tenant combination
    if (data.scope === "platform") {
      // ensure caller is platform admin for platform-scope tickets
      const { data: isAdmin } = await context.supabase
        .rpc("is_platform_admin", { _user_id: context.userId });
      if (!isAdmin) throw new Error("Only platform admins can raise platform-scope tickets");
    } else if (!data.tenant_id) {
      throw new Error("tenant_id is required for workspace/tenant tickets");
    }

    let sla_policy_id: string | null = null;
    if (data.tenant_id) {
      const { data: sla } = await context.supabase
        .from("sla_policies").select("id").eq("tenant_id", data.tenant_id)
        .eq("priority", data.priority).maybeSingle();
      sla_policy_id = (sla as any)?.id ?? null;
    }
    const queue = data.scope === "platform" ? "platform" : "tenant";
    // Row-boundary encrypt for support_tickets.body (customer-supplied text).
    const { encryptField } = await import("./crypto.server");
    const encryptedBody = await encryptField(data.body);
    const { data: row, error } = await context.supabase
      .from("support_tickets").insert({
        tenant_id: data.scope === "platform" ? null : data.tenant_id!,
        scope: data.scope,
        recon_id: data.recon_id ?? null,
        subject: data.subject,
        body: encryptedBody,
        priority: data.priority,
        category: data.category,
        attachments: data.attachments,
        queue,
        created_by: context.userId,
        sla_policy_id,
      } as any).select("id, ref, tenant_id, scope").single();
    if (error) throw new Error(error.message);
    const tenantMeta = await loadTenant(data.scope === "platform" ? null : (data.tenant_id ?? null));
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id ?? null,
      scope: data.scope, action: "ticket.create",
      resource_type: "support_ticket", resource_id: row.id,
      context: {
        ref: row.ref,
        subject: data.subject,
        priority: data.priority,
        category: data.category,
        scope: data.scope,
        tenant_name: tenantMeta?.name ?? null,
        tenant_slug: tenantMeta?.slug ?? null,
      },
    } as any);
    return row;
  });

export const addTicketMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      ticket_id: z.string().uuid(),
      body: z.string().trim().min(1).max(8000),
      internal_note: z.boolean().default(false),
    }).parse(d))
  .handler(async ({ data, context }) => {
    // Row-boundary encrypt for ticket_messages.body.
    const { encryptField } = await import("./crypto.server");
    const encryptedBody = await encryptField(data.body);
    const { error } = await context.supabase.from("ticket_messages").insert({
      ticket_id: data.ticket_id, author_id: context.userId,
      body: encryptedBody, internal_note: data.internal_note,
    });
    if (error) throw new Error(error.message);
    const { data: t } = await context.supabase
      .from("support_tickets").select("first_response_at, tenant_id, created_by")
      .eq("id", data.ticket_id).single();
    if (t && !(t as any).first_response_at && (t as any).created_by !== context.userId) {
      await context.supabase.from("support_tickets")
        .update({ first_response_at: new Date().toISOString() })
        .eq("id", data.ticket_id);
    }
    return { ok: true };
  });

export const updateTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      status: statusEnum.optional(),
      priority: priorityEnum.optional(),
      category: categoryEnum.optional(),
      assignee_id: z.string().uuid().nullable().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    // Load prior state so we can validate + write a rich, diff-shaped audit row.
    const { data: prior, error: priorErr } = await context.supabase
      .from("support_tickets")
      .select("id, ref, subject, tenant_id, scope, status, priority, category, assignee_id")
      .eq("id", data.id).single();
    if (priorErr || !prior) throw new Error(priorErr?.message ?? "Ticket not visible");
    const priorRow = prior as any;

    // Server-side scope-aware assignee validation. Prevents cross-tenant
    // assignment and enforces "platform tickets → platform admins only",
    // even if a caller bypasses the UI drop-down.
    if (data.assignee_id !== undefined && data.assignee_id !== null) {
      const allowed = await resolveAssignableUserIds(context, {
        tenant_id: priorRow.tenant_id ?? null,
        scope: priorRow.scope ?? "tenant",
      });
      if (!allowed.has(data.assignee_id)) {
        throw new Response(
          "Assignee is not allowed for this ticket's scope (must be a platform admin, or a tenant_admin of the ticket's tenant)",
          { status: 403 },
        );
      }
    }

    const patch: any = {};
    if (data.status !== undefined) {
      patch.status = data.status;
      if (data.status === "resolved") patch.resolved_at = new Date().toISOString();
      if (data.status === "closed") patch.closed_at = new Date().toISOString();
    }
    if (data.priority !== undefined) patch.priority = data.priority;
    if (data.category !== undefined) patch.category = data.category;
    if (data.assignee_id !== undefined) patch.assignee_id = data.assignee_id;

    const { data: row, error } = await context.supabase
      .from("support_tickets").update(patch).eq("id", data.id)
      .select("id, tenant_id, scope, ref").single();
    if (error) throw new Error(error.message);
    const rowAny = row as any;

    // Build per-field before/after diff so audit reviewers can see exactly
    // what changed on every touch (not just the incoming patch).
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of ["status", "priority", "category", "assignee_id"] as const) {
      const incoming = (data as any)[key];
      if (incoming === undefined) continue;
      if (priorRow[key] !== incoming) diff[key] = { from: priorRow[key] ?? null, to: incoming ?? null };
    }
    const tenantMeta = await loadTenant(rowAny.tenant_id);

    // If the assignee changed, emit a dedicated ticket.assign event alongside
    // the generic ticket.update — makes the assignment trail trivial to filter.
    if ("assignee_id" in diff) {
      const [fromProfile, toProfile] = await Promise.all([
        priorRow.assignee_id ? loadProfile(priorRow.assignee_id) : Promise.resolve(null),
        data.assignee_id ? loadProfile(data.assignee_id) : Promise.resolve(null),
      ]);
      await context.supabase.from("audit_log").insert({
        actor_user_id: context.userId, tenant_id: rowAny.tenant_id,
        scope: rowAny.scope ?? "tenant", action: "ticket.assign",
        resource_type: "support_ticket", resource_id: rowAny.id,
        context: {
          ref: rowAny.ref,
          subject: priorRow.subject,
          tenant_name: tenantMeta?.name ?? null,
          tenant_slug: tenantMeta?.slug ?? null,
          from_user_id: priorRow.assignee_id ?? null,
          from_user_email: fromProfile?.email ?? null,
          from_user_name: fromProfile?.full_name ?? null,
          to_user_id: data.assignee_id ?? null,
          to_user_email: toProfile?.email ?? null,
          to_user_name: toProfile?.full_name ?? null,
        },
      } as any);
    }

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: rowAny.tenant_id,
      scope: rowAny.scope ?? "tenant", action: "ticket.update",
      resource_type: "support_ticket", resource_id: rowAny.id,
      context: {
        ref: rowAny.ref,
        subject: priorRow.subject,
        tenant_name: tenantMeta?.name ?? null,
        tenant_slug: tenantMeta?.slug ?? null,
        changes: diff,
        patch,
      },
    } as any);
    return { ok: true };
  });

export const escalateTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: prior, error: priorErr } = await context.supabase
      .from("support_tickets")
      .select("id, ref, subject, tenant_id, queue, status")
      .eq("id", data.id).single();
    if (priorErr || !prior) throw new Error(priorErr?.message ?? "Ticket not visible");
    const priorRow = prior as any;
    const { data: row, error } = await context.supabase
      .from("support_tickets").update({
        queue: "platform",
        escalated_at: new Date().toISOString(),
        escalated_reason: data.reason,
        status: "in_progress",
      }).eq("id", data.id).select("id, tenant_id, ref").single();
    if (error) throw new Error(error.message);
    const tenantMeta = await loadTenant((row as any).tenant_id);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: row.tenant_id,
      scope: "tenant", action: "ticket.escalate",
      resource_type: "support_ticket", resource_id: row.id,
      context: {
        ref: row.ref,
        subject: priorRow.subject,
        reason: data.reason,
        tenant_name: tenantMeta?.name ?? null,
        tenant_slug: tenantMeta?.slug ?? null,
        from_queue: priorRow.queue ?? null,
        to_queue: "platform",
        from_status: priorRow.status ?? null,
        to_status: "in_progress",
      },
    } as any);
    return { ok: true };
  });

export const submitCsat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      csat_score: z.number().int().min(1).max(5),
      csat_comment: z.string().max(1000).optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("support_tickets")
      .update({ csat_score: data.csat_score, csat_comment: data.csat_comment ?? null })
      .eq("id", data.id).eq("created_by", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// SLA policies
export const listSla = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("sla_policies").select("*").eq("tenant_id", data.tenant_id).order("priority");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertSla = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      priority: priorityEnum,
      name: z.string().min(2).max(80),
      first_response_mins: z.number().int().min(1),
      resolution_mins: z.number().int().min(1),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("sla_policies").upsert({
      tenant_id: data.tenant_id, priority: data.priority,
      name: data.name, first_response_mins: data.first_response_mins,
      resolution_mins: data.resolution_mins,
    }, { onConflict: "tenant_id,priority" });
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id,
      scope: "tenant", action: "sla.upsert",
      resource_type: "sla_policy", resource_id: data.priority,
      context: { ...data },
    } as any);
    return { ok: true };
  });

/**
 * Export Copilot-driven ticket audit events (creation, comments, updates,
 * escalations, SLA / status-check activity) as CSV rows. RLS scopes the
 * read: tenant members see their tenant, platform admins see all.
 */
export const exportTicketAuditCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid().optional(),
      ticket_id: z.string().uuid().optional(),
      since_iso: z.string().datetime().optional(),
      until_iso: z.string().datetime().optional(),
      copilot_only: z.boolean().default(false),
    }).parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("audit_log")
      .select("occurred_at, actor_user_id, actor_email, tenant_id, tenant_slug, scope, action, resource_id, context")
      .eq("resource_type", "support_ticket")
      .order("occurred_at", { ascending: false })
      .limit(10000);
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    if (data.ticket_id) q = q.eq("resource_id", data.ticket_id);
    if (data.since_iso) q = q.gte("occurred_at", data.since_iso);
    if (data.until_iso) q = q.lte("occurred_at", data.until_iso);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const filtered = (rows ?? []).filter((r: any) =>
      !data.copilot_only || (r.context && r.context.surface === "copilot")
    );
    // Audit the export itself
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id ?? null,
      scope: data.tenant_id ? "tenant" : "platform",
      action: "ticket.audit_export",
      resource_type: "support_ticket_audit",
      resource_id: data.ticket_id ?? "bulk",
      context: {
        row_count: filtered.length,
        filters: {
          ticket_id: data.ticket_id ?? null,
          since: data.since_iso ?? null,
          until: data.until_iso ?? null,
          copilot_only: data.copilot_only,
        },
      },
    } as any);
    return {
      rows: filtered.map((r: any) => ({
        occurred_at: r.occurred_at,
        action: r.action,
        actor_email: r.actor_email ?? "",
        actor_user_id: r.actor_user_id ?? "",
        tenant_id: r.tenant_id ?? "",
        tenant_slug: r.tenant_slug ?? "",
        scope: r.scope ?? "",
        ticket_id: r.resource_id ?? "",
        ref: r.context?.ref ?? "",
        surface: r.context?.surface ?? "",
        thread_id: r.context?.thread_id ?? "",
        details: JSON.stringify(r.context ?? {}),
      })),
      count: filtered.length,
    };
  });
