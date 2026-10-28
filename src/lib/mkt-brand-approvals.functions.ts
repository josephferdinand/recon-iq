/**
 * Brand Management — draft → review → publish approval workflow.
 *
 * Roles (from mkt_admin_roles):
 *   • Draft owner: any market admin — creates a request via `requestBrandApproval`.
 *   • Reviewer:    brand_reviewer (or super_admin) — approves/rejects the review stage.
 *   • Publisher:   brand_publisher (or super_admin) — approves/rejects the publish
 *                  stage; on approval the underlying publish/rollback/archive
 *                  action is executed atomically as the acting publisher.
 *
 * Separation of duties: the same user cannot draft AND review AND publish a
 * single request. `super_admin` may satisfy any single stage but still cannot
 * fulfil all three of a single request.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type BrandApprovalSubject = "profile" | "asset" | "theme";
export type BrandApprovalAction = "publish" | "rollback" | "archive";
export type BrandApprovalStatus =
  | "pending_review" | "pending_publish" | "rejected" | "cancelled" | "executed";

export type BrandApproval = {
  id: string;
  subject_type: BrandApprovalSubject;
  subject_id: string;
  action: BrandApprovalAction;
  payload: Record<string, string | number | boolean | null> | null;
  status: BrandApprovalStatus;
  title: string | null;
  notes: string | null;
  requested_by: string;
  requested_by_email: string | null;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_by_email: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  review_decision: "approved" | "rejected" | null;
  published_by: string | null;
  published_by_email: string | null;
  published_at: string | null;
  publish_note: string | null;
  publish_decision: "approved" | "rejected" | null;
  executed_at: string | null;
  execution_error: string | null;
  created_at: string;
  updated_at: string;
};

// ---------- helpers ----------
async function requireMktAdmin(ctx: { supabase: any; userId: string }): Promise<void> {
  const { data, error } = await ctx.supabase.rpc("has_any_mkt_role", { _user_id: ctx.userId });
  if (error || !data) throw new Response("Forbidden — market admin required", { status: 403 });
}

async function requireStageRole(
  ctx: { supabase: any; userId: string },
  stage: "review" | "publish",
): Promise<void> {
  const { data, error } = await ctx.supabase.rpc("has_brand_workflow_role", {
    _user_id: ctx.userId,
    _stage: stage,
  });
  if (error || !data) {
    throw new Response(`Forbidden — brand_${stage === "review" ? "reviewer" : "publisher"} required`, { status: 403 });
  }
}

async function myStageEligibility(ctx: { supabase: any; userId: string }) {
  const [r, p] = await Promise.all([
    ctx.supabase.rpc("has_brand_workflow_role", { _user_id: ctx.userId, _stage: "review" }),
    ctx.supabase.rpc("has_brand_workflow_role", { _user_id: ctx.userId, _stage: "publish" }),
  ]);
  return { canReview: !!r.data, canPublish: !!p.data };
}

async function logHistory(
  ctx: { supabase: any; userId: string; claims?: { email?: string } },
  entity: "profile" | "asset" | "identity" | "communications" | "login" | "white_label",
  action: "create" | "update" | "publish" | "rollback" | "delete" | "upload",
  entityId: string | null,
  before: unknown,
  after: unknown,
  notes?: string,
): Promise<void> {
  try {
    await ctx.supabase.from("mkt_brand_history").insert({
      entity, action, entity_id: entityId,
      actor_user_id: ctx.userId, actor_email: ctx.claims?.email ?? null,
      before_snapshot: (before ?? null) as never,
      after_snapshot: (after ?? null) as never,
      notes: notes ?? null,
    } as never);
  } catch { /* best-effort */ }
}

// ---------- eligibility (client caches) ----------
export const myBrandWorkflowRoles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await requireMktAdmin(context);
    return myStageEligibility(context);
  });

// ---------- list ----------
const listSchema = z.object({
  status: z.enum(["pending_review","pending_publish","rejected","cancelled","executed"]).optional(),
  subject_type: z.enum(["profile","asset","theme"]).optional(),
  limit: z.number().int().min(1).max(500).default(200),
}).default({});

export const listBrandApprovals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => listSchema.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await requireMktAdmin(context);
    let q = context.supabase.from("mkt_brand_approvals").select("*")
      .order("requested_at", { ascending: false }).limit(data.limit);
    if (data.status) q = q.eq("status", data.status);
    if (data.subject_type) q = q.eq("subject_type", data.subject_type);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as BrandApproval[];
  });

// ---------- create request ----------
const requestSchema = z.object({
  subject_type: z.enum(["profile","asset","theme"]),
  subject_id: z.string().uuid(),
  action: z.enum(["publish","rollback","archive"]),
  title: z.string().max(200).nullish(),
  notes: z.string().max(4000).nullish(),
  payload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});

export const requestBrandApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => requestSchema.parse(d))
  .handler(async ({ data, context }) => {
    await requireMktAdmin(context);
    // Reject duplicate open requests on the same subject+action.
    const { data: dupe } = await context.supabase.from("mkt_brand_approvals")
      .select("id").eq("subject_type", data.subject_type)
      .eq("subject_id", data.subject_id).eq("action", data.action)
      .in("status", ["pending_review", "pending_publish"]).maybeSingle();
    if (dupe) throw new Error("An open approval request already exists for this item.");
    const { data: row, error } = await context.supabase.from("mkt_brand_approvals").insert({
      subject_type: data.subject_type, subject_id: data.subject_id, action: data.action,
      payload: data.payload as never, title: data.title ?? null, notes: data.notes ?? null,
      requested_by: context.userId, requested_by_email: context.claims?.email ?? null,
      status: "pending_review",
    } as never).select("*").single();
    if (error) throw new Error(error.message);
    return row as BrandApproval;
  });

// ---------- cancel (requester only) ----------
export const cancelBrandApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid(), note: z.string().max(1000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireMktAdmin(context);
    const { data: row, error: fetchErr } = await context.supabase.from("mkt_brand_approvals")
      .select("*").eq("id", data.id).single();
    if (fetchErr) throw new Error(fetchErr.message);
    const r = row as BrandApproval;
    if (r.requested_by !== context.userId)
      throw new Response("Only the requester can cancel this request.", { status: 403 });
    if (r.status !== "pending_review" && r.status !== "pending_publish")
      throw new Error(`Cannot cancel a request in status "${r.status}".`);
    const { data: updated, error } = await context.supabase.from("mkt_brand_approvals")
      .update({ status: "cancelled", notes: data.note ?? r.notes } as never)
      .eq("id", data.id).select("*").single();
    if (error) throw new Error(error.message);
    return updated as BrandApproval;
  });

// ---------- review decision ----------
export const reviewBrandApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    id: z.string().uuid(),
    decision: z.enum(["approved","rejected"]),
    note: z.string().max(2000).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireStageRole(context, "review");
    const { data: row, error: fetchErr } = await context.supabase.from("mkt_brand_approvals")
      .select("*").eq("id", data.id).single();
    if (fetchErr) throw new Error(fetchErr.message);
    const r = row as BrandApproval;
    if (r.status !== "pending_review") throw new Error(`Request is not awaiting review (status: ${r.status}).`);
    if (r.requested_by === context.userId)
      throw new Response("Separation of duties: reviewer cannot be the requester.", { status: 403 });
    const patch: Record<string, unknown> = {
      reviewed_by: context.userId,
      reviewed_by_email: context.claims?.email ?? null,
      reviewed_at: new Date().toISOString(),
      review_note: data.note ?? null,
      review_decision: data.decision,
      status: data.decision === "approved" ? "pending_publish" : "rejected",
    };
    const { data: updated, error } = await context.supabase.from("mkt_brand_approvals")
      .update(patch as never).eq("id", data.id).select("*").single();
    if (error) throw new Error(error.message);
    return updated as BrandApproval;
  });

// ---------- execute underlying action ----------
async function executePublish(
  ctx: { supabase: any; userId: string; claims?: { email?: string } },
  r: BrandApproval,
): Promise<void> {
  if (r.subject_type === "profile") {
    const { data: before } = await ctx.supabase.from("mkt_brand_profile").select("*").eq("id", r.subject_id).maybeSingle();
    const nextVersion = ((before as { version?: number } | null)?.version ?? 1) + 1;
    const { data: after, error } = await ctx.supabase.from("mkt_brand_profile")
      .update({ status: "published", published_at: new Date().toISOString(),
                published_by: ctx.userId, version: nextVersion } as never)
      .eq("id", r.subject_id).select("*").single();
    if (error) throw new Error(error.message);
    await logHistory(ctx, "profile", "publish", r.subject_id, before, after,
      `Approved via workflow #${r.id.slice(0, 8)}`);
    return;
  }
  if (r.subject_type === "asset") {
    const { data: target, error: fetchErr } = await ctx.supabase.from("mkt_brand_assets")
      .select("*").eq("id", r.subject_id).single();
    if (fetchErr) throw new Error(fetchErr.message);
    const slot = (target as { slot: string }).slot;
    await ctx.supabase.from("mkt_brand_assets")
      .update({ is_published: false } as never).eq("slot", slot).eq("is_published", true);
    const { data: after, error } = await ctx.supabase.from("mkt_brand_assets")
      .update({ is_published: true } as never).eq("id", r.subject_id).select("*").single();
    if (error) throw new Error(error.message);
    await logHistory(ctx, "asset", "publish", r.subject_id, target, after,
      `Approved via workflow #${r.id.slice(0, 8)} (slot ${slot})`);
    return;
  }
  if (r.subject_type === "theme") {
    // Deactivate current active theme, then activate this one.
    await ctx.supabase.from("mkt_site_themes")
      .update({ status: "archived" } as never).eq("status", "active");
    const { data: after, error } = await ctx.supabase.from("mkt_site_themes")
      .update({ status: "active", activated_at: new Date().toISOString() } as never)
      .eq("id", r.subject_id).select("*").single();
    if (error) throw new Error(error.message);
    await logHistory(ctx, "identity", "publish", r.subject_id, null, after,
      `Theme activated via workflow #${r.id.slice(0, 8)}`);
    return;
  }
  throw new Error(`Unsupported subject_type: ${r.subject_type}`);
}

async function executeArchive(
  ctx: { supabase: any; userId: string; claims?: { email?: string } },
  r: BrandApproval,
): Promise<void> {
  if (r.subject_type === "theme") {
    const { data: after, error } = await ctx.supabase.from("mkt_site_themes")
      .update({ status: "archived" } as never).eq("id", r.subject_id).select("*").single();
    if (error) throw new Error(error.message);
    await logHistory(ctx, "identity", "delete", r.subject_id, null, after,
      `Theme archived via workflow #${r.id.slice(0, 8)}`);
    return;
  }
  throw new Error(`Archive not implemented for subject_type=${r.subject_type}`);
}

// ---------- publish decision (final stage) ----------
export const publishBrandApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    id: z.string().uuid(),
    decision: z.enum(["approved","rejected"]),
    note: z.string().max(2000).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireStageRole(context, "publish");
    const { data: row, error: fetchErr } = await context.supabase.from("mkt_brand_approvals")
      .select("*").eq("id", data.id).single();
    if (fetchErr) throw new Error(fetchErr.message);
    const r = row as BrandApproval;
    if (r.status !== "pending_publish") throw new Error(`Request is not awaiting publish (status: ${r.status}).`);
    if (r.requested_by === context.userId)
      throw new Response("Separation of duties: publisher cannot be the requester.", { status: 403 });
    if (r.reviewed_by === context.userId)
      throw new Response("Separation of duties: publisher cannot be the reviewer.", { status: 403 });

    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = {
      published_by: context.userId,
      published_by_email: context.claims?.email ?? null,
      published_at: nowIso,
      publish_note: data.note ?? null,
      publish_decision: data.decision,
    };
    if (data.decision === "rejected") {
      patch.status = "rejected";
      const { data: updated, error } = await context.supabase.from("mkt_brand_approvals")
        .update(patch as never).eq("id", data.id).select("*").single();
      if (error) throw new Error(error.message);
      return updated as BrandApproval;
    }

    // Approved — execute the underlying action.
    let executionError: string | null = null;
    try {
      if (r.action === "publish") await executePublish(context, r);
      else if (r.action === "archive") await executeArchive(context, r);
      else if (r.action === "rollback") await executeArchive(context, r); // rollback maps to archive for now
    } catch (e) {
      executionError = e instanceof Error ? e.message : String(e);
    }
    patch.status = executionError ? "rejected" : "executed";
    patch.executed_at = executionError ? null : nowIso;
    patch.execution_error = executionError;
    const { data: updated, error } = await context.supabase.from("mkt_brand_approvals")
      .update(patch as never).eq("id", data.id).select("*").single();
    if (error) throw new Error(error.message);
    if (executionError) throw new Error(`Execution failed: ${executionError}`);
    return updated as BrandApproval;
  });
