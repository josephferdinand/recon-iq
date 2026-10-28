// Plan-mode review queue: list / approve+execute / reject proposed agent actions,
// plus a per-action audit timeline. Approval re-runs the same mutation against
// CURRENT data (the agent's plan-mode call only recorded the proposed action;
// no row was mutated). Reversal is handled by `revertAgentAction` in agent.functions.ts.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { withRlsAudit, isRlsDenial, logRlsDenial } from "@/lib/rls-audit.server";
import { enforceSelfApprovalGuard } from "@/lib/agent-runner.server";

type ToolName = "set_break_lifecycle" | "add_break_comment";

async function assertWriter(ctx: any, tenantId: string) {
  const [a, b] = await Promise.all([
    ctx.supabase.rpc("has_tenant_role", { _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_admin" }),
    ctx.supabase.rpc("has_tenant_role", { _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_analyst" }),
  ]);
  if (!a.data && !b.data) throw new Error("Forbidden: analyst or admin role required");
}

async function assertApprover(ctx: any, tenantId: string) {
  // Approvers must be tenant_admin (separation of duties from the agent runner).
  const { data: isAdmin } = await ctx.supabase.rpc("has_tenant_role", {
    _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_admin",
  });
  if (!isAdmin) throw new Error("Forbidden: tenant_admin required to approve agent actions");
}

export const listProposedAgentActions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    limit: z.number().int().min(1).max(200).default(100),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const { data: rows, error } = await context.supabase
      .from("agent_actions")
      .select(`
        id, tool, input, output, status, proposed, policy_ceiling,
        reversal_token, before_state, rejection_reason,
        created_at, approved_by, reverted_at,
        run:agent_runs(id, objective, user_id, mode, autonomy:scope_limits, created_at)
      `)
      .eq("tenant_id", data.tenant_id)
      .eq("proposed", true)
      .in("status", ["pending", "approved", "rejected"])
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getAgentActionTimeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    action_id: z.string().uuid(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const { data: action, error } = await context.supabase
      .from("agent_actions")
      .select(`
        id, run_id, tool, input, output, status, proposed, policy_ceiling,
        reversal_token, before_state, rejection_reason, rejection_reason,
        approved_by, reverted_at, reverted_by, created_at,
        run:agent_runs(id, objective, user_id, mode, status, summary, created_at)
      `)
      .eq("id", data.action_id)
      .eq("tenant_id", data.tenant_id)
      .single();
    if (error || !action) throw new Error(error?.message ?? "Action not found");

    // Pull the matching audit_log rows (run + revert).
    const { data: auditRows } = await context.supabase
      .from("audit_log")
      .select("id, occurred_at, action, actor_user_id, resource_type, resource_id, context")
      .eq("tenant_id", data.tenant_id)
      .or(`resource_id.eq.${(action as any).id},resource_id.eq.${(action as any).run_id}`)
      .order("occurred_at", { ascending: true })
      .limit(50);

    // Compose chronological timeline events.
    const events: Array<{
      at: string; kind: string; label: string; actor?: string | null; payload?: any;
    }> = [];

    events.push({
      at: (action as any).run?.created_at,
      kind: "plan",
      label: "Plan recorded by agent",
      actor: (action as any).run?.user_id,
      payload: { objective: (action as any).run?.objective, mode: (action as any).run?.mode },
    });
    events.push({
      at: (action as any).created_at,
      kind: "proposed",
      label: `Proposed: ${(action as any).tool}`,
      payload: { input: (action as any).input, before_state: (action as any).before_state, policy_ceiling: (action as any).policy_ceiling },
    });
    if ((action as any).status === "approved" || (action as any).status === "completed") {
      events.push({
        at: (auditRows ?? []).find((a) => a.action === "agent.action.approve")?.occurred_at ?? (action as any).created_at,
        kind: "approved",
        label: "Approved & executed",
        actor: (action as any).approved_by,
        payload: { reversal_token: (action as any).reversal_token, output: (action as any).output },
      });
    }
    if ((action as any).status === "rejected") {
      events.push({
        at: (auditRows ?? []).find((a) => a.action === "agent.action.reject")?.occurred_at ?? (action as any).created_at,
        kind: "rejected",
        label: "Rejected",
        actor: (action as any).approved_by,
        payload: { reason: (action as any).rejection_reason },
      });
    }
    if ((action as any).reverted_at) {
      events.push({
        at: (action as any).reverted_at,
        kind: "reverted",
        label: "Reverted via reversal token",
        actor: (action as any).reverted_by,
        payload: { reversal_token: (action as any).reversal_token },
      });
    }

    return { action, audit: auditRows ?? [], events };
  });

export const approveAgentAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    action_id: z.string().uuid(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertApprover(context, data.tenant_id);

    const { data: act, error } = await context.supabase.from("agent_actions")
      .select("id, tool, input, status, proposed, run_id, run:agent_runs(user_id)")
      .eq("id", data.action_id).eq("tenant_id", data.tenant_id).single();
    if (error || !act) throw new Error("Action not found");
    if (!act.proposed) throw new Error("Action is not a proposed plan-mode action");
    if (act.status !== "pending") throw new Error(`Action already ${act.status}`);

    // Phase 1.5 / Fable #1 — block self-approval (defense-in-depth on top of the DB trigger).
    enforceSelfApprovalGuard((act as any).run?.user_id, context.userId);


    const tool = act.tool as ToolName;
    const input: any = act.input;
    let output: any = null;
    let beforeSnap: any = null;
    let reversal_token: string | null = crypto.randomUUID();

    switch (tool) {
      case "set_break_lifecycle": {
        const { data: prev } = await context.supabase.from("recon_exceptions")
          .select("id, lifecycle_state, status, root_cause, resolved_at, resolved_by")
          .eq("id", input.exception_id).eq("tenant_id", data.tenant_id).single();
        beforeSnap = prev;
        const patch: any = { lifecycle_state: input.lifecycle_state, root_cause: input.root_cause ?? null };
        if (input.lifecycle_state === "resolved" || input.lifecycle_state === "written_off") {
          patch.status = input.lifecycle_state === "resolved" ? "resolved" : "wont_fix";
          patch.resolved_at = new Date().toISOString();
          patch.resolved_by = context.userId;
        }
        const { error: uErr } = await context.supabase.from("recon_exceptions")
          .update(patch).eq("id", input.exception_id).eq("tenant_id", data.tenant_id);
        if (uErr) throw new Error(uErr.message);
        output = { ok: true };
        break;
      }
      case "add_break_comment": {
        const { data: ins, error: iErr } = await context.supabase.from("break_comments").insert({
          exception_id: input.exception_id, tenant_id: data.tenant_id,
          author_id: context.userId, body: `[Agent · approved] ${input.body}`, internal: true,
        } as any).select("id").single();
        if (iErr) throw new Error(iErr.message);
        beforeSnap = { comment_id: ins?.id };
        output = { ok: true, id: ins?.id };
        break;
      }
      default:
        throw new Error(`Approval executor not implemented for tool "${tool}"`);
    }

    const { error: upErr } = await context.supabase.from("agent_actions").update({
      status: "completed",
      proposed: false,
      approved_by: context.userId,
      output, before_state: beforeSnap, reversal_token,
    } as any).eq("id", act.id);
    if (upErr) throw new Error(upErr.message);

    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenant_id, scope: "workspace", action: "agent.action.approve",
      resource_type: "agent_action", resource_id: act.id,
      context: { tool, run_id: act.run_id, reversal_token } as any,
    } as any);

    return { ok: true, output, reversal_token };
  });

export const rejectAgentAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    action_id: z.string().uuid(),
    reason: z.string().min(3).max(500),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertApprover(context, data.tenant_id);
    const { data: act, error } = await context.supabase.from("agent_actions")
      .select("id, status, proposed").eq("id", data.action_id).eq("tenant_id", data.tenant_id).single();
    if (error || !act) throw new Error("Action not found");
    if (!act.proposed) throw new Error("Action is not a proposed plan-mode action");
    if (act.status !== "pending") throw new Error(`Action already ${act.status}`);

    const { error: uErr } = await context.supabase.from("agent_actions").update({
      status: "rejected", approved_by: context.userId, rejection_reason: data.reason,
    } as any).eq("id", act.id);
    if (uErr) throw new Error(uErr.message);

    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenant_id, scope: "workspace", action: "agent.action.reject",
      resource_type: "agent_action", resource_id: act.id,
      context: { reason: data.reason } as any,
    } as any);
    return { ok: true };
  });

// Platform: residency-denial events across all tenants (security_events critical).
export const listResidencyDenials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid().optional(),
    since_hours: z.number().int().min(1).max(24 * 90).default(24 * 7),
    model: z.string().optional(),
    limit: z.number().int().min(1).max(500).default(100),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_platform_admin", { _user_id: context.userId });
    if (!isAdmin) throw new Error("Forbidden: platform admin required");
    const since = new Date(Date.now() - data.since_hours * 3600_000).toISOString();
    let q = context.supabase.from("security_events")
      .select("id, tenant_id, user_id, event_type, severity, details, occurred_at, tenant:tenants(name, slug)")
      .eq("event_type", "residency_violation")
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .limit(data.limit);
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    let out = rows ?? [];
    if (data.model) out = out.filter((r: any) => (r.details?.model ?? "").includes(data.model!));
    return out;
  });

// Tenant defaults (scope caps) — used by AgentPoliciesTab.
export const getTenantAgentDefaults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.from("tenants")
      .select("agent_max_actions, agent_max_distinct_tables")
      .eq("id", data.tenant_id).single();
    if (error) throw new Error(error.message);
    return row;
  });

export const setTenantAgentDefaults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    agent_max_actions: z.number().int().min(1).max(500),
    agent_max_distinct_tables: z.number().int().min(1).max(50),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_tenant_role", {
      _user_id: context.userId, _tenant_id: data.tenant_id, _role: "tenant_admin",
    });
    if (!isAdmin) throw new Error("Forbidden: tenant_admin required");
    const { error } = await context.supabase.from("tenants").update({
      agent_max_actions: data.agent_max_actions,
      agent_max_distinct_tables: data.agent_max_distinct_tables,
    } as any).eq("id", data.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ──────────────────────────────────────────────────────────────────────────────
// Bulk approvals / rejections (single confirmation step with per-action notes)
// ──────────────────────────────────────────────────────────────────────────────

const BulkItem = z.object({
  action_id: z.string().uuid(),
  note: z.string().max(500).optional(),
});

async function _executeApprovedAction(
  ctx: any, tenantId: string, actId: string, approverUserId: string, note?: string,
) {
  const { data: act, error } = await ctx.supabase.from("agent_actions")
    .select("id, tool, input, status, proposed, run_id, run:agent_runs(user_id)")
    .eq("id", actId).eq("tenant_id", tenantId).single();
  if (error || !act) throw new Error("Action not found");
  if (!act.proposed) throw new Error("Action is not a proposed plan-mode action");
  if (act.status !== "pending") throw new Error(`Action already ${act.status}`);
  enforceSelfApprovalGuard((act as any).run?.user_id, approverUserId);

  const tool = act.tool as ToolName;
  const input: any = act.input;
  let output: any = null;
  let beforeSnap: any = null;
  const reversal_token = crypto.randomUUID();

  switch (tool) {
    case "set_break_lifecycle": {
      const { data: prev } = await ctx.supabase.from("recon_exceptions")
        .select("id, lifecycle_state, status, root_cause, resolved_at, resolved_by")
        .eq("id", input.exception_id).eq("tenant_id", tenantId).single();
      beforeSnap = prev;
      const patch: any = { lifecycle_state: input.lifecycle_state, root_cause: input.root_cause ?? null };
      if (input.lifecycle_state === "resolved" || input.lifecycle_state === "written_off") {
        patch.status = input.lifecycle_state === "resolved" ? "resolved" : "wont_fix";
        patch.resolved_at = new Date().toISOString();
        patch.resolved_by = approverUserId;
      }
      const { error: uErr } = await ctx.supabase.from("recon_exceptions")
        .update(patch).eq("id", input.exception_id).eq("tenant_id", tenantId);
      if (uErr) throw new Error(uErr.message);
      output = { ok: true };
      break;
    }
    case "add_break_comment": {
      const { data: ins, error: iErr } = await ctx.supabase.from("break_comments").insert({
        exception_id: input.exception_id, tenant_id: tenantId,
        author_id: approverUserId, body: `[Agent · approved] ${input.body}`, internal: true,
      } as any).select("id").single();
      if (iErr) throw new Error(iErr.message);
      beforeSnap = { comment_id: ins?.id };
      output = { ok: true, id: ins?.id };
      break;
    }
    default:
      throw new Error(`Approval executor not implemented for tool "${tool}"`);
  }

  const { error: upErr } = await ctx.supabase.from("agent_actions").update({
    status: "completed", proposed: false,
    approved_by: approverUserId,
    output, before_state: beforeSnap, reversal_token,
  } as any).eq("id", act.id);
  if (upErr) throw new Error(upErr.message);

  await ctx.supabase.from("audit_log").insert({
    tenant_id: tenantId, scope: "workspace", action: "agent.action.approve",
    resource_type: "agent_action", resource_id: act.id,
    context: { tool, run_id: act.run_id, reversal_token, note: note ?? null } as any,
  } as any);

  return { action_id: actId, ok: true as const, reversal_token };
}

export const bulkApproveAgentActions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    items: z.array(BulkItem).min(1).max(100),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertApprover(context, data.tenant_id);
    const results: Array<{ action_id: string; ok: boolean; error?: string; reversal_token?: string }> = [];
    for (const item of data.items) {
      try {
        const r = await _executeApprovedAction(context, data.tenant_id, item.action_id, context.userId, item.note);
        results.push(r);
      } catch (e: any) {
        if (isRlsDenial(e)) {
          await logRlsDenial(e, {
            tenant_id: data.tenant_id, user_id: context.userId,
            resource: "agent_actions.bulk_approve",
            context: { action_id: item.action_id },
          });
        }
        results.push({ action_id: item.action_id, ok: false, error: e?.message ?? "Failed" });
      }
    }
    const succeeded = results.filter((r) => r.ok).length;
    return { ok: true, succeeded, failed: results.length - succeeded, results };
  });

export const bulkRejectAgentActions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    items: z.array(BulkItem.extend({ note: z.string().min(3).max(500) })).min(1).max(100),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertApprover(context, data.tenant_id);
    const results: Array<{ action_id: string; ok: boolean; error?: string }> = [];
    for (const item of data.items) {
      try {
        const { data: act, error } = await context.supabase.from("agent_actions")
          .select("id, status, proposed")
          .eq("id", item.action_id).eq("tenant_id", data.tenant_id).single();
        if (error || !act) throw new Error("Action not found");
        if (!act.proposed) throw new Error("Not a proposed action");
        if (act.status !== "pending") throw new Error(`Already ${act.status}`);

        const { error: uErr } = await context.supabase.from("agent_actions").update({
          status: "rejected", approved_by: context.userId, rejection_reason: item.note,
        } as any).eq("id", act.id);
        if (uErr) throw new Error(uErr.message);

        await context.supabase.from("audit_log").insert({
          tenant_id: data.tenant_id, scope: "workspace", action: "agent.action.reject",
          resource_type: "agent_action", resource_id: act.id,
          context: { reason: item.note, bulk: true } as any,
        } as any);
        results.push({ action_id: item.action_id, ok: true });
      } catch (e: any) {
        if (isRlsDenial(e)) {
          await logRlsDenial(e, {
            tenant_id: data.tenant_id, user_id: context.userId,
            resource: "agent_actions.bulk_reject",
            context: { action_id: item.action_id },
          });
        }
        results.push({ action_id: item.action_id, ok: false, error: e?.message ?? "Failed" });
      }
    }
    const succeeded = results.filter((r) => r.ok).length;
    return { ok: true, succeeded, failed: results.length - succeeded, results };
  });

// ──────────────────────────────────────────────────────────────────────────────
// Admin-only export endpoints (CSV/PDF compliance reports)
// Returns the same data as the viewer fns but enforces tenant_admin /
// platform_admin and writes an audit_log entry so exports are tracked.
// ──────────────────────────────────────────────────────────────────────────────

export const exportAgentActionTimeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    action_id: z.string().uuid(),
    format: z.enum(["csv", "pdf"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertApprover(context, data.tenant_id);
    return withRlsAudit(async () => {
      const { data: action, error } = await context.supabase
        .from("agent_actions")
        .select(`
          id, run_id, tool, input, output, status, proposed, policy_ceiling,
          reversal_token, before_state, rejection_reason,
          approved_by, reverted_at, reverted_by, created_at,
          run:agent_runs(id, objective, user_id, mode, status, summary, created_at)
        `)
        .eq("id", data.action_id).eq("tenant_id", data.tenant_id).single();
      if (error || !action) throw new Error(error?.message ?? "Action not found");

      const { data: auditRows } = await context.supabase
        .from("audit_log")
        .select("id, occurred_at, action, actor_user_id, resource_type, resource_id, context")
        .eq("tenant_id", data.tenant_id)
        .or(`resource_id.eq.${(action as any).id},resource_id.eq.${(action as any).run_id}`)
        .order("occurred_at", { ascending: true })
        .limit(50);

      await context.supabase.from("audit_log").insert({
        tenant_id: data.tenant_id, scope: "tenant", action: "agent.timeline.export",
        resource_type: "agent_action", resource_id: data.action_id,
        context: { format: data.format } as any,
      } as any);

      return { action, audit: auditRows ?? [] };
    }, {
      tenant_id: data.tenant_id, user_id: context.userId,
      resource: "agent_actions.export_timeline",
      context: { action_id: data.action_id, format: data.format },
    });
  });

export const exportResidencyDenials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid().optional(),
    since_hours: z.number().int().min(1).max(24 * 90).default(24 * 7),
    model: z.string().optional(),
    limit: z.number().int().min(1).max(5000).default(1000),
    format: z.enum(["csv", "pdf"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_platform_admin", { _user_id: context.userId });
    if (!isAdmin) throw new Error("Forbidden: platform admin required to export residency denials");
    return withRlsAudit(async () => {
      const since = new Date(Date.now() - data.since_hours * 3600_000).toISOString();
      let q = context.supabase.from("security_events")
        .select("id, tenant_id, user_id, event_type, severity, details, occurred_at, tenant:tenants(name, slug)")
        .eq("event_type", "residency_violation")
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: false })
        .limit(data.limit);
      if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      let out = rows ?? [];
      if (data.model) out = out.filter((r: any) => (r.details?.model ?? "").includes(data.model!));

      await context.supabase.from("audit_log").insert({
        tenant_id: data.tenant_id ?? null, scope: "platform", action: "residency.denials.export",
        resource_type: "security_events", resource_id: null,
        context: { format: data.format, since_hours: data.since_hours, model: data.model ?? null, count: out.length } as any,
      } as any);

      return out;
    }, {
      tenant_id: data.tenant_id ?? null, user_id: context.userId,
      resource: "security_events.export_residency",
      context: { format: data.format, since_hours: data.since_hours },
    });
  });



// ──────────────────────────────────────────────────────────────────────────────
// Platform: RLS-denial events (security_events.event_type='rls_denied').
// Populated by src/lib/rls-audit.server.ts whenever a server function's
// supabase call hits PG code 42501 / "permission denied for table".
// ──────────────────────────────────────────────────────────────────────────────
export const listRlsDenials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid().optional(),
    since_hours: z.number().int().min(1).max(24 * 90).default(24 * 7),
    resource: z.string().optional(),
    limit: z.number().int().min(1).max(500).default(100),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_platform_admin", { _user_id: context.userId });
    if (!isAdmin) throw new Error("Forbidden: platform admin required");
    const since = new Date(Date.now() - data.since_hours * 3600_000).toISOString();
    let q = context.supabase.from("security_events")
      .select("id, tenant_id, user_id, event_type, severity, context, occurred_at, tenant:tenants(name, slug)")
      .eq("event_type", "rls_denied")
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .limit(data.limit);
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    let out = rows ?? [];
    if (data.resource) out = out.filter((r: any) => String(r.context?.resource ?? "").includes(data.resource!));
    return out;
  });
