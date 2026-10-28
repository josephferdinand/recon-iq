import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertWriter(ctx: any, tenantId: string) {
  const { data: a } = await ctx.supabase.rpc("has_tenant_role", {
    _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_admin",
  });
  const { data: b } = await ctx.supabase.rpc("has_tenant_role", {
    _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_analyst",
  });
  if (!a && !b) throw new Error("Forbidden: analyst or admin role required");
}

export type ExceptionMatchIssue = "missing_counterpart" | "invalid_key" | "rule_failure" | "aggregate_mismatch" | "other";

const MATCH_ISSUE_LABELS: Record<ExceptionMatchIssue, string> = {
  missing_counterpart: "Missing counterpart",
  invalid_key: "Invalid or missing key",
  rule_failure: "Rule validation failure",
  aggregate_mismatch: "Aggregate mismatch",
  other: "Other exception",
};

/** Maps only persisted engine reason prefixes; never surfaces embedded key or record values as a classification. */
export function classifyExceptionMatchIssue(reason: unknown): { code: ExceptionMatchIssue; label: string } {
  const text = typeof reason === "string" ? reason : "";
  const code: ExceptionMatchIssue = text.startsWith("Unmatched: no counterpart") ? "missing_counterpart"
    : text.startsWith("Invalid or missing reconciliation key") ? "invalid_key"
      : text.startsWith("Rule failed:") || text.startsWith("Validation failed:") ? "rule_failure"
        : text.startsWith("Sum mismatch for key") ? "aggregate_mismatch" : "other";
  return { code, label: MATCH_ISSUE_LABELS[code] };
}

export const listBreaks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    lifecycle: z.array(z.string()).optional(),
    priority: z.string().optional(),
    assignee: z.string().uuid().optional(),
    q: z.string().optional(),
    limit: z.number().min(1).max(500).default(200),
  }).parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("recon_exceptions")
      .select("id, run_id, reason, severity, status, lifecycle_state, priority, due_date, root_cause, tags, assignee, side, payload, created_at, updated_at, run:recon_runs(id, started_at, definition:recon_definitions(id, name))")
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.lifecycle?.length) q = q.in("lifecycle_state", data.lifecycle);
    if (data.priority) q = q.eq("priority", data.priority);
    if (data.assignee) q = q.eq("assignee", data.assignee);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    let out = rows ?? [];
    if (data.q) {
      const s = data.q.toLowerCase();
      out = out.filter((r: any) =>
        (r.reason ?? "").toLowerCase().includes(s) ||
        (r.root_cause ?? "").toLowerCase().includes(s) ||
        (r.run?.definition?.name ?? "").toLowerCase().includes(s));
    }
    return out;
  });

export const listExceptionPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    page: z.number().int().min(0),
    page_size: z.number().int().min(10).max(50),
    status: z.enum(["open", "investigating", "resolved", "wont_fix"]).optional(),
    severity: z.enum(["critical", "high", "medium", "low"]).optional(),
    lifecycle_state: z.enum(["new", "assigned", "investigating", "pending_counterparty", "resolved", "written_off", "unspecified"]).optional(),
    q: z.string().trim().max(100).regex(/^[\p{L}\p{N}\s._@:/+'%_-]*$/u, "Use letters, numbers, spaces, and simple separators in search.").optional(),
    sort: z.enum(["created_at", "updated_at"]).default("created_at"),
    ascending: z.boolean().default(false),
  }).parse(d))
  .handler(async ({ data, context }) => {
    let query = context.supabase.from("recon_exceptions")
      .select("id, public_case_id, run_id, reason, severity, status, lifecycle_state, priority, due_date, root_cause, tags, assignee, side, payload, created_at, updated_at, run:recon_runs(id, run_uid, started_at, definition:recon_definitions(id, name))", { count: "exact" })
      .eq("tenant_id", data.tenant_id)
      .order(data.sort, { ascending: data.ascending })
      .order("id", { ascending: data.ascending });
    if (data.status) query = query.eq("status", data.status);
    if (data.severity) query = query.eq("severity", data.severity);
    if (data.lifecycle_state === "unspecified") query = query.is("lifecycle_state", null);
    else if (data.lifecycle_state) query = query.eq("lifecycle_state", data.lifecycle_state);
    if (data.q) {
      // Substring search has no dedicated trigram/full-text index in this slice; verify latency with large tenant populations.
      const search = data.q.replace(/[\\%_\"]/g, "\\$&");
      const textSearch = `reason.ilike."%${search}%",root_cause.ilike."%${search}%"`;
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.q);
      const publicCaseId = /^FVI-EXC-[A-F0-9]{32}$/i.test(data.q) ? data.q.toUpperCase() : null;
      if (publicCaseId) {
        query = (query as any).eq("public_case_id", publicCaseId);
      } else if (!uuid && /^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(data.q)) {
        // Public Run IDs such as R-20260924-... are not recon_runs UUIDs.
        const { data: run, error: runError } = await context.supabase.from("recon_runs")
          .select("id")
          .eq("tenant_id", data.tenant_id)
          .ilike("run_uid", data.q)
          .maybeSingle();
        if (runError) throw new Error("Run ID search is temporarily unavailable. Please try again.");
        query = run ? query.eq("run_id", run.id) : query.or(textSearch);
      } else {
        query = query.or(uuid ? `id.eq.${data.q},run_id.eq.${data.q},${textSearch}` : textSearch);
      }
    }
    const start = data.page * data.page_size;
    const { data: rows, error, count } = await query.range(start, start + data.page_size - 1);
    if (error) throw new Error("Exception cases could not be loaded. Try again; if this continues, contact your administrator.");
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || !Array.isArray(rows)) {
      throw new Error("Exception totals are unavailable, so the queue cannot be shown safely. Retry in a moment.");
    }
    return {
      items: rows.map((row: any) => {
        const { reason, ...safeRow } = row;
        return { ...safeRow, match_issue: classifyExceptionMatchIssue(reason) };
      }),
      total: count,
    };
  });

export const updateBreak = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    id: z.string().uuid(),
    patch: z.object({
      lifecycle_state: z.enum(["new","assigned","investigating","pending_counterparty","resolved"]).optional(),
      priority: z.enum(["P1","P2","P3","P4"]).optional(),
      assignee: z.string().uuid().nullable().optional(),
      due_date: z.string().nullable().optional(),
      root_cause: z.string().max(500).nullable().optional(),
      tags: z.array(z.string().max(40)).max(20).optional(),
    }),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const patch: any = { ...data.patch };
    if (patch.lifecycle_state === "resolved") {
      patch.status = "resolved";
      patch.resolved_at = new Date().toISOString();
      patch.resolved_by = context.userId;
    }
    const { error } = await context.supabase.from("recon_exceptions")
      .update(patch).eq("id", data.id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenant_id, scope: "workspace", action: "break.update",
      resource_type: "recon_exception", resource_id: data.id, context: data.patch as any,
    } as any);
    return { ok: true };
  });

export const bulkUpdateBreaks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    ids: z.array(z.string().uuid()).min(1).max(500),
    patch: z.object({
      lifecycle_state: z.enum(["new","assigned","investigating","pending_counterparty","resolved"]).optional(),
      priority: z.enum(["P1","P2","P3","P4"]).optional(),
      assignee: z.string().uuid().nullable().optional(),
    }),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const patch: any = { ...data.patch };
    if (patch.lifecycle_state === "resolved") {
      patch.status = "resolved";
      patch.resolved_at = new Date().toISOString();
      patch.resolved_by = context.userId;
    }
    const { error } = await context.supabase.from("recon_exceptions")
      .update(patch).in("id", data.ids).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenant_id, scope: "workspace", action: "break.bulk_update",
      resource_type: "recon_exception", resource_id: null,
      context: { count: data.ids.length, patch: data.patch } as any,
    } as any);
    return { ok: true, count: data.ids.length };
  });

export const listComments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid(), exception_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("break_comments")
      .select("id, body, internal, created_at, author_id")
      .eq("tenant_id", data.tenant_id)
      .eq("exception_id", data.exception_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const list = rows ?? [];
    // author_id references auth.users, not profiles, so resolve names separately.
    const authorIds = [...new Set(list.map((r: any) => r.author_id).filter(Boolean))];
    const names = new Map<string, string | null>();
    if (authorIds.length) {
      const { data: profs } = await context.supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", authorIds);
      for (const p of (profs ?? []) as any[]) names.set(p.id, p.full_name ?? null);
    }
    return list.map((r: any) => ({ ...r, author: { full_name: names.get(r.author_id) ?? null } }));
  });

export const addComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    exception_id: z.string().uuid(),
    body: z.string().min(1).max(4000),
    internal: z.boolean().default(true),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: parent, error: parentError } = await context.supabase
      .from("recon_exceptions")
      .select("id")
      .eq("id", data.exception_id)
      .eq("tenant_id", data.tenant_id)
      .maybeSingle();
    if (parentError || !parent) throw new Error("Break not found in active tenant scope");

    const { data: comment, error } = await context.supabase.from("break_comments").insert({
      tenant_id: data.tenant_id,
      exception_id: data.exception_id,
      author_id: context.userId,
      body: data.body,
      internal: data.internal,
    } as never).select("id").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenant_id,
      scope: "workspace",
      action: "break.comment.create",
      resource_type: "break_comment",
      resource_id: comment.id,
      context: { exception_id: data.exception_id, internal: data.internal },
    } as never);
    return { ok: true, id: comment.id };
  });

export const listAttachments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ exception_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("break_attachments")
      .select("id, filename, mime_type, size_bytes, storage_path, created_at, uploader_id")
      .eq("exception_id", data.exception_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const recordAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    exception_id: z.string().uuid(),
    filename: z.string().min(1).max(255),
    mime_type: z.string().max(100).optional(),
    size_bytes: z.number().int().min(0).optional(),
    storage_path: z.string().max(500).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const { data: parent, error: parentError } = await context.supabase
      .from("recon_exceptions")
      .select("id")
      .eq("id", data.exception_id)
      .eq("tenant_id", data.tenant_id)
      .maybeSingle();
    if (parentError || !parent) throw new Error("Break not found in active tenant scope");

    const { data: attachment, error } = await context.supabase.from("break_attachments").insert({
      tenant_id: data.tenant_id,
      exception_id: data.exception_id,
      uploader_id: context.userId,
      filename: data.filename,
      mime_type: data.mime_type ?? null,
      size_bytes: data.size_bytes ?? null,
      storage_path: data.storage_path ?? null,
    } as never).select("id").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenant_id,
      scope: "workspace",
      action: "break.attachment.create",
      resource_type: "break_attachment",
      resource_id: attachment.id,
      context: {
        exception_id: data.exception_id,
        filename: data.filename,
        mime_type: data.mime_type ?? null,
        size_bytes: data.size_bytes ?? null,
      },
    } as never);
    return { ok: true, id: attachment.id };
  });
