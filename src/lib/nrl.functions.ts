import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { parseNRL, renderNRL, type CompiledNRLRule } from "@/lib/nrl/parser";

/**
 * NRL & exception-lifecycle server functions.
 *
 * Surfaces:
 *  - compileNRL: stateless preview that returns the compiled JSON + errors.
 *  - listNRLRules / upsertNRLRule / deleteNRLRule: persistence for a recon
 *    definition's NRL rule set.
 *  - assignException / writeOffException / closeException / reopenException /
 *    setReviewState / setLabels: lifecycle actions that mutate
 *    recon_exceptions AND append a row to recon_exception_transitions.
 *  - listExceptionTransitions: audit history for a single break.
 *  - listConsolidatedMatches: reads v_recon_matches_consolidated for the
 *    Matches tab.
 */

async function assertWriter(ctx: any, tenantId: string) {
  const { data: a } = await ctx.supabase.rpc("has_tenant_role", {
    _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_admin",
  });
  const { data: b } = await ctx.supabase.rpc("has_tenant_role", {
    _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_analyst",
  });
  if (!a && !b) throw new Error("Forbidden: analyst or admin role required");
}

async function recordTransition(
  ctx: any,
  tenantId: string,
  exceptionId: string,
  fromState: string | null,
  toState: string,
  transitionType: string,
  reason?: string,
  context: Record<string, unknown> = {},
) {
  await ctx.supabase.from("recon_exception_transitions").insert({
    tenant_id: tenantId,
    exception_id: exceptionId,
    actor_user_id: ctx.userId,
    from_state: fromState,
    to_state: toState,
    transition_type: transitionType,
    reason: reason ?? null,
    context,
  });
}

// ---------------- NRL compile / persist ----------------

export const compileNRL = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ source: z.string().max(4000) }).parse(d))
  .handler(async ({ data }) => {
    const result = parseNRL(data.source);
    return {
      ok: result.errors.length === 0,
      compiled: result.rule ?? null,
      canonical: result.rule ? renderNRL(result.rule) : null,
      errors: result.errors,
    };
  });

export const listNRLRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      definition_id: z.string().uuid(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("recon_nrl_rules")
      .select("id, name, description, nrl_source, compiled_rule, pass_order, enabled, validation_errors, updated_at")
      .eq("tenant_id", data.tenant_id)
      .eq("definition_id", data.definition_id)
      .order("pass_order", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertNRLRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      tenant_id: z.string().uuid(),
      definition_id: z.string().uuid(),
      name: z.string().min(2).max(120),
      description: z.string().max(500).optional(),
      nrl_source: z.string().min(3).max(4000),
      pass_order: z.number().int().min(1).max(50).default(1),
      enabled: z.boolean().default(true),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const parsed = parseNRL(data.nrl_source);
    if (!parsed.rule) {
      throw new Error("NRL rule has errors: " + parsed.errors.map(e => e.message).join("; "));
    }
    const compiled: CompiledNRLRule = parsed.rule;
    const payload = {
      tenant_id: data.tenant_id,
      definition_id: data.definition_id,
      name: data.name,
      description: data.description ?? null,
      nrl_source: data.nrl_source,
      compiled_rule: compiled as unknown as Record<string, unknown>,
      pass_order: data.pass_order,
      enabled: data.enabled,
      validation_errors: parsed.errors as unknown as Record<string, unknown>[],
      created_by: context.userId,
    };
    if (data.id) {
      const { error } = await context.supabase.from("recon_nrl_rules")
        .update(payload as never).eq("id", data.id).eq("tenant_id", data.tenant_id);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: row, error } = await context.supabase.from("recon_nrl_rules")
      .insert(payload as never).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: row.id };
  });

export const deleteNRLRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const { error } = await context.supabase.from("recon_nrl_rules")
      .delete().eq("id", data.id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- Exception lifecycle ----------------

export const assignException = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      exception_id: z.string().uuid(),
      assignee: z.string().uuid().nullable(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const { data: prev } = await context.supabase.from("recon_exceptions")
      .select("assignee, review_state").eq("id", data.exception_id).single();
    const { error } = await context.supabase.from("recon_exceptions").update({
      assignee: data.assignee,
      assigned_by: data.assignee ? context.userId : null,
      assigned_at: data.assignee ? new Date().toISOString() : null,
    }).eq("id", data.exception_id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await recordTransition(context, data.tenant_id, data.exception_id,
      prev?.review_state ?? null, prev?.review_state ?? "unreviewed",
      data.assignee ? "assigned" : "unassigned", undefined,
      { assignee: data.assignee, previous_assignee: prev?.assignee ?? null });
    return { ok: true };
  });

export const setReviewState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      exception_id: z.string().uuid(),
      review_state: z.enum(["unreviewed", "under_review", "reviewed"]),
      reason: z.string().max(2000).optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const { data: prev } = await context.supabase.from("recon_exceptions")
      .select("review_state").eq("id", data.exception_id).single();
    const { error } = await context.supabase.from("recon_exceptions")
      .update({ review_state: data.review_state })
      .eq("id", data.exception_id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await recordTransition(context, data.tenant_id, data.exception_id,
      prev?.review_state ?? null, data.review_state, "review_state", data.reason);
    return { ok: true };
  });

export const writeOffException = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      exception_id: z.string().uuid(),
      amount: z.number(),
      currency: z.string().min(2).max(8),
      gl_account: z.string().max(64),
      reason: z.string().min(3).max(500),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const { data: request, error } = await context.supabase.rpc("request_break_write_off", {
      _tenant_id: data.tenant_id,
      _exception_id: data.exception_id,
      _requester_id: context.userId,
      _amount: data.amount,
      _currency: data.currency.toUpperCase(),
      _gl_account: data.gl_account,
      _reason: data.reason,
    });
    if (error) {
      if (error.code === "23505") throw new Error("A write-off request is already awaiting approval");
      throw new Error(error.message);
    }
    const created = request?.[0];
    if (!created) throw new Error("Write-off request was not returned");
    return { ok: true, request_id: created.request_id, status: created.request_status };
  });

export const listBreakWriteOffRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid(), exception_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.from("break_write_off_requests")
      .select("id,amount,currency,gl_account,reason,status,requested_by,decided_by,decided_at,decision_note,created_at")
      .eq("tenant_id", data.tenant_id).eq("exception_id", data.exception_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const decideBreakWriteOff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    request_id: z.string().uuid(),
    decision: z.enum(["approved", "rejected"]),
    decision_note: z.string().max(2000).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: admin } = await context.supabase.rpc("has_tenant_role", {
      _user_id: context.userId, _tenant_id: data.tenant_id, _role: "tenant_admin",
    });
    if (!admin) throw new Error("Active tenant administrator approval required");
    const { data: result, error } = await context.supabase.rpc("decide_break_write_off", {
      _tenant_id: data.tenant_id,
      _request_id: data.request_id,
      _approver_id: context.userId,
      _decision: data.decision,
      _decision_note: data.decision_note,
    });
    if (error) throw new Error(error.message);
    return result?.[0] ?? { request_id: data.request_id, decision_status: data.decision };
  });

export const closeException = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      exception_id: z.string().uuid(),
      reason: z.string().min(3).max(500),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const { error } = await context.supabase.from("recon_exceptions").update({
      status: "resolved",
      lifecycle_state: "resolved",
      closed_at: new Date().toISOString(),
      close_reason: data.reason,
      resolved_by: context.userId,
      resolved_at: new Date().toISOString(),
    }).eq("id", data.exception_id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await recordTransition(context, data.tenant_id, data.exception_id,
      null, "resolved", "closed", data.reason);
    return { ok: true };
  });

export const reopenException = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      exception_id: z.string().uuid(),
      reason: z.string().min(3).max(500),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const { error } = await context.supabase.from("recon_exceptions").update({
      status: "open",
      lifecycle_state: "new",
      reopened_at: new Date().toISOString(),
      reopen_reason: data.reason,
      resolved_by: null,
      resolved_at: null,
      closed_at: null,
    }).eq("id", data.exception_id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await recordTransition(context, data.tenant_id, data.exception_id,
      "resolved", "new", "reopened", data.reason);
    return { ok: true };
  });

export const setExceptionLabels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      exception_id: z.string().uuid(),
      labels: z.array(z.string().min(1).max(40)).max(20),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const { error } = await context.supabase.from("recon_exceptions")
      .update({ labels: data.labels })
      .eq("id", data.exception_id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true, labels: data.labels };
  });

export const listExceptionTransitions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      exception_id: z.string().uuid(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("recon_exception_transitions")
      .select("id, from_state, to_state, transition_type, reason, context, occurred_at, actor_user_id")
      .eq("tenant_id", data.tenant_id)
      .eq("exception_id", data.exception_id)
      .order("occurred_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ---------------- Consolidated matches view ----------------

export const listConsolidatedMatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      run_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(1000).default(200),
    }).parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("v_recon_matches_consolidated")
      .select("match_id, run_id, match_key, rule_id, cardinality, confidence, score, side_a, side_b, side_c, deltas, created_at")
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.run_id) q = q.eq("run_id", data.run_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
