import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createFviAiProvider, assertResidencyCompliant, resolveFviAiBaseUrl, resolvePlatformAiApiKey } from "@/lib/ai/provider-router.server";
import { checkBudget } from "@/lib/ai-metering.server";
import { generateText, tool, stepCountIs } from "ai";
import {
  enforceBlastRadius,
  enforceHourlyActionLimit,
  emitAgentReversalEvent,
  requireProductionRunStepUp,
  TOOL_TO_ACTION_KIND,
  BLAST_RADIUS_DEFAULT,
  BLAST_RADIUS_ADMIN_OVERRIDE,
} from "./agent-runner.server";

type Ceiling = "suggest" | "assist" | "auto";

const DEFAULT_POLICY: Record<string, { ceiling: Ceiling; reversible: boolean; required_approvers: number }> = {
  search_breaks:       { ceiling: "auto",    reversible: true,  required_approvers: 0 },
  inspect_break:       { ceiling: "auto",    reversible: true,  required_approvers: 0 },
  report_overview:     { ceiling: "auto",    reversible: true,  required_approvers: 0 },
  add_break_comment:   { ceiling: "assist",  reversible: true,  required_approvers: 0 },
  set_break_lifecycle: { ceiling: "assist",  reversible: true,  required_approvers: 1 },
};

const READ_TOOLS = new Set(["search_breaks", "inspect_break", "report_overview"]);

function assertReadOnlyAgentRequest(autonomy: string) {
  if (autonomy !== "read_only") throw new Error("This Agent surface is restricted to read-only requests. Write autonomy is not enabled.");
}

const MODEL_ID = "google/gemini-3-flash-preview";

async function loadResidency(ctx: any, tenantId: string, model: string) {
  const [{ data: res }, { data: mr }] = await Promise.all([
    ctx.supabase.from("tenant_data_residency")
      .select("primary_region_code, secondary_region_code, pinned_pii")
      .eq("tenant_id", tenantId).maybeSingle(),
    ctx.supabase.from("llm_model_regions").select("allowed_regions").eq("model", model).maybeSingle(),
  ]);
  const allowed: string[] = res
    ? [res.primary_region_code, res.secondary_region_code].filter(Boolean) as string[]
    : [];
  return {
    tenantId,
    allowedRegions: allowed,
    modelAllowedRegions: (mr?.allowed_regions ?? []) as string[],
    pinnedPii: !!res?.pinned_pii,
  };
}

async function loadPolicies(ctx: any, tenantId: string) {
  const { data } = await ctx.supabase
    .from("agent_action_policies")
    .select("action_key, ceiling, required_approvers, reversible, tenant_id")
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`);
  const map: Record<string, { ceiling: Ceiling; reversible: boolean; required_approvers: number }> = { ...DEFAULT_POLICY };
  // Tenant-specific overrides win
  (data ?? []).sort((a: any, b: any) => (a.tenant_id ? 1 : 0) - (b.tenant_id ? 1 : 0));
  for (const row of data ?? []) {
    map[row.action_key] = {
      ceiling: row.ceiling, reversible: row.reversible, required_approvers: row.required_approvers,
    };
  }
  return map;
}

async function checkRateLimit(ctx: any, tenantId: string) {
  const minute = new Date(); minute.setSeconds(0, 0);
  const iso = minute.toISOString();
  const { data: row } = await ctx.supabase.from("agent_action_rate_limits")
    .select("count").eq("tenant_id", tenantId).eq("bucket_minute", iso).maybeSingle();
  const current = row?.count ?? 0;
  if (current >= 60) throw new Error("Agent rate limit exceeded: 60 write actions/minute per tenant.");
  await ctx.supabase.from("agent_action_rate_limits")
    .upsert({ tenant_id: tenantId, bucket_minute: iso, count: current + 1 } as any, { onConflict: "tenant_id,bucket_minute" });
}

async function assertWriter(ctx: any, tenantId: string) {
  const [a, b] = await Promise.all([
    ctx.supabase.rpc("has_tenant_role", { _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_admin" }),
    ctx.supabase.rpc("has_tenant_role", { _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_analyst" }),
  ]);
  if (!a.data && !b.data) throw new Error("Forbidden: analyst or admin role required");
}

export const listAgentRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid(), limit: z.number().int().min(1).max(100).default(20) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.from("agent_runs")
      .select("id, objective, status, summary, steps, mode, scope_limits, planned_actions_count, executed_actions_count, distinct_tables_touched, created_at, updated_at")
      .eq("tenant_id", data.tenant_id).order("created_at", { ascending: false }).limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const runAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    objective: z.string().min(5).max(2000),
    autonomy: z.enum(["read_only", "supervised", "autonomous"]).default("read_only"),
    mode: z.enum(["plan", "execute"]).default("execute"),
    max_actions: z.number().int().min(1).max(200).default(50),
    max_distinct_tables: z.number().int().min(1).max(50).default(10),
  }).parse(d))
  .handler(async ({ data, context }) => {
    assertReadOnlyAgentRequest(data.autonomy);
    await assertWriter(context, data.tenant_id);

    // PR5 / Fable #3 — blast-radius cap (default 50/10; tenant_admin override 500/50).
    const { data: isTenantAdmin } = await context.supabase.rpc("has_tenant_role", {
      _user_id: context.userId, _tenant_id: data.tenant_id, _role: "tenant_admin",
    });
    const caps = isTenantAdmin ? BLAST_RADIUS_ADMIN_OVERRIDE : BLAST_RADIUS_DEFAULT;
    enforceBlastRadius({
      plannedActions: data.max_actions,
      distinctTables: data.max_distinct_tables,
      isTenantAdminOverride: !!isTenantAdmin,
    });
    // Clamp scope_limits to whichever cap actually applies.
    data.max_actions = Math.min(data.max_actions, caps.maxActions);
    data.max_distinct_tables = Math.min(data.max_distinct_tables, caps.maxDistinctTables);

    const { data: t } = await context.supabase.from("tenants")
      .select("ai_enabled, name").eq("id", data.tenant_id).single();
    if (!t?.ai_enabled) throw new Error("AI is disabled for this tenant. Enable it in Tenant management → AI & LLM.");

    const apiKey = resolvePlatformAiApiKey();
    if (!apiKey) throw new Error("Platform AI provider not configured (missing FVI_AI_API_KEY / vault credential)");

    // PR2: residency check
    const residency = await loadResidency(context, data.tenant_id, MODEL_ID);
    try {
      assertResidencyCompliant(residency, MODEL_ID);
    } catch (e: any) {
      await context.supabase.from("security_events").insert({
        tenant_id: data.tenant_id, user_id: context.userId,
        event_type: "residency_violation", severity: "critical",
        details: { model: MODEL_ID, reason: e?.message, surface: "agent" } as any,
      } as any);
      throw e;
    }

    // PR1: load policies
    const policies = await loadPolicies(context, data.tenant_id);

    const { data: run, error: rErr } = await context.supabase.from("agent_runs").insert({
      tenant_id: data.tenant_id,
      user_id: context.userId,
      scope: "workspace",
      objective: data.objective,
      status: data.mode === "plan" ? "awaiting_approval" : "running",
      mode: data.mode,
      scope_limits: { max_actions: data.max_actions, max_distinct_tables: data.max_distinct_tables } as any,
      steps: [],
    } as any).select("id").single();
    if (rErr || !run) throw new Error(rErr?.message ?? "failed to create run");
    const runId = run.id;
    const steps: any[] = [];
    const tablesTouched = new Set<string>();
    let executedCount = 0;
    let plannedCount = 0;

    const recordAction = async (params: {
      tool: string;
      input: any;
      output?: any;
      table?: string;
      before_state?: any;
      error?: string;
    }) => {
      const policy = policies[params.tool] ?? { ceiling: "suggest" as Ceiling, reversible: true, required_approvers: 1 };
      const reversal_token = policy.reversible && params.before_state ? crypto.randomUUID() : null;
      if (params.table) tablesTouched.add(params.table);
      const proposed = data.mode === "plan";
      if (proposed) plannedCount++; else executedCount++;
      steps.push({ tool: params.tool, input: params.input, output: params.output ?? null, proposed, at: new Date().toISOString(), error: params.error });
      await context.supabase.from("agent_actions").insert({
        run_id: runId, tenant_id: data.tenant_id,
        tool: params.tool,
        action_kind: TOOL_TO_ACTION_KIND[params.tool] ?? params.tool,
        input: params.input ?? {}, output: params.output ?? null,
        status: params.error ? "failed" : (proposed ? "pending" : "completed"),
        proposed, policy_ceiling: policy.ceiling,
        reversal_token, before_state: params.before_state ?? null,
      } as any);
    };

    const enforceScope = (toolName: string, table?: string) => {
      const cap = data.max_actions;
      const tcap = data.max_distinct_tables;
      if (executedCount + plannedCount >= cap)
        throw new Error(`Scope cap reached: ${cap} actions per run. Re-run with a narrower objective or higher cap.`);
      if (table && !tablesTouched.has(table) && tablesTouched.size >= tcap)
        throw new Error(`Scope cap reached: ${tcap} distinct tables per run.`);
      // Autonomy gate
      const policy = policies[toolName] ?? { ceiling: "suggest" as Ceiling, reversible: true, required_approvers: 1 };
      const isRead = READ_TOOLS.has(toolName);
      if (!isRead) {
        if (data.autonomy === "read_only")
          throw new Error(`Tool "${toolName}" blocked: read_only autonomy.`);
        if (policy.ceiling === "suggest" && data.mode === "execute")
          throw new Error(`Tool "${toolName}" requires policy "suggest"; use plan mode (--mode=plan) for review.`);
        if (policy.ceiling === "assist" && data.autonomy !== "autonomous" && data.mode === "execute")
          throw new Error(`Tool "${toolName}" requires "autonomous" autonomy or plan mode.`);
      }
      return policy;
    };

    const tools: Record<string, any> = {
      search_breaks: tool({
        description: "Search reconciliation exceptions (breaks) in this tenant.",
        inputSchema: z.object({
          status: z.enum(["new","assigned","investigating","pending_counterparty","resolved","written_off","any"]).default("any"),
          severity: z.enum(["low","medium","high","critical","any"]).default("any"),
          query: z.string().optional(),
          limit: z.number().int().min(1).max(100).default(25),
        }),
        execute: async (input) => {
          enforceScope("search_breaks");
          let q = context.supabase.from("recon_exceptions")
            .select("id, reason, severity, lifecycle_state, priority, due_date, root_cause, side, created_at, run:recon_runs(definition:recon_definitions(name))")
            .eq("tenant_id", data.tenant_id).order("created_at", { ascending: false }).limit(input.limit);
          if (input.status !== "any") q = q.eq("lifecycle_state", input.status);
          if (input.severity !== "any") q = q.eq("severity", input.severity);
          const { data: rows, error } = await q;
          if (error) throw new Error(error.message);
          let out = rows ?? [];
          if (input.query) {
            const s = input.query.toLowerCase();
            out = out.filter((r: any) => (r.reason ?? "").toLowerCase().includes(s) || (r.root_cause ?? "").toLowerCase().includes(s));
          }
          await recordAction({ tool: "search_breaks", input, output: { count: out.length } });
          return out;
        },
      }),
      inspect_break: tool({
        description: "Get full payload for one exception.",
        inputSchema: z.object({ exception_id: z.string().uuid() }),
        execute: async (input) => {
          enforceScope("inspect_break");
          const { data: row, error } = await context.supabase.from("recon_exceptions")
            .select("*").eq("id", input.exception_id).eq("tenant_id", data.tenant_id).single();
          if (error) throw new Error(error.message);
          await recordAction({ tool: "inspect_break", input, output: { ok: true } });
          return row;
        },
      }),
      report_overview: tool({
        description: "KPIs/trends for last N days.",
        inputSchema: z.object({ days: z.number().int().min(7).max(90).default(30) }),
        execute: async (input) => {
          enforceScope("report_overview");
          const since = new Date(Date.now() - input.days * 86400000).toISOString();
          const [runs, exc] = await Promise.all([
            context.supabase.from("recon_runs").select("matched_count, exception_count, status").eq("tenant_id", data.tenant_id).gte("started_at", since),
            context.supabase.from("recon_exceptions").select("severity, lifecycle_state, created_at, resolved_at").eq("tenant_id", data.tenant_id).gte("created_at", since),
          ]);
          const matched = (runs.data ?? []).reduce((a: number, r: any) => a + (r.matched_count ?? 0), 0);
          const exceptions = (runs.data ?? []).reduce((a: number, r: any) => a + (r.exception_count ?? 0), 0);
          const open = (exc.data ?? []).filter((e: any) => !["resolved","written_off"].includes(e.lifecycle_state));
          const out = {
            window_days: input.days, runs: runs.data?.length ?? 0,
            matched, exceptions, open_breaks: open.length,
            match_rate_pct: matched + exceptions > 0 ? Math.round((matched / (matched + exceptions)) * 1000) / 10 : 0,
          };
          await recordAction({ tool: "report_overview", input, output: out });
          return out;
        },
      }),
      set_break_lifecycle: tool({
        description: "Update a break's lifecycle state and optional root cause.",
        inputSchema: z.object({
          exception_id: z.string().uuid(),
          lifecycle_state: z.enum(["new","assigned","investigating","pending_counterparty","resolved","written_off"]),
          root_cause: z.string().max(500).optional(),
        }),
        execute: async (input) => {
          enforceScope("set_break_lifecycle", "recon_exceptions");
          // Snapshot before-state for reversal
          const { data: prev } = await context.supabase.from("recon_exceptions")
            .select("id, lifecycle_state, status, root_cause, resolved_at, resolved_by")
            .eq("id", input.exception_id).eq("tenant_id", data.tenant_id).single();
          if (data.mode === "plan") {
            await recordAction({ tool: "set_break_lifecycle", input, output: { proposed: true }, table: "recon_exceptions", before_state: prev });
            return { proposed: true };
          }
          await checkRateLimit(context, data.tenant_id);
          await enforceHourlyActionLimit(context.supabase, {
            tenantId: data.tenant_id, agentKey: "default",
            actionKind: TOOL_TO_ACTION_KIND.set_break_lifecycle,
            userId: context.userId,
          });
          const patch: any = { lifecycle_state: input.lifecycle_state, root_cause: input.root_cause ?? null };
          if (input.lifecycle_state === "resolved" || input.lifecycle_state === "written_off") {
            patch.status = input.lifecycle_state === "resolved" ? "resolved" : "wont_fix";
            patch.resolved_at = new Date().toISOString();
            patch.resolved_by = context.userId;
          }
          const { error } = await context.supabase.from("recon_exceptions")
            .update(patch).eq("id", input.exception_id).eq("tenant_id", data.tenant_id);
          if (error) throw new Error(error.message);
          await recordAction({ tool: "set_break_lifecycle", input, output: { ok: true }, table: "recon_exceptions", before_state: prev });
          return { ok: true };
        },
      }),
      add_break_comment: tool({
        description: "Add an internal comment to a break.",
        inputSchema: z.object({ exception_id: z.string().uuid(), body: z.string().min(1).max(2000) }),
        execute: async (input) => {
          enforceScope("add_break_comment", "break_comments");
          if (data.mode === "plan") {
            await recordAction({ tool: "add_break_comment", input, output: { proposed: true }, table: "break_comments", before_state: { created: false } });
            return { proposed: true };
          }
          await checkRateLimit(context, data.tenant_id);
          await enforceHourlyActionLimit(context.supabase, {
            tenantId: data.tenant_id, agentKey: "default",
            actionKind: TOOL_TO_ACTION_KIND.add_break_comment,
            userId: context.userId,
          });
          const { data: ins, error } = await context.supabase.from("break_comments").insert({
            exception_id: input.exception_id, tenant_id: data.tenant_id,
            author_id: context.userId, body: `[Agent] ${input.body}`, internal: true,
          } as any).select("id").single();
          if (error) throw new Error(error.message);
          await recordAction({ tool: "add_break_comment", input, output: { ok: true, id: ins?.id }, table: "break_comments", before_state: { comment_id: ins?.id } });
          return { ok: true };
        },
      }),
    };

    // C6 — LLM cost guardrail: enforce per-tenant budget BEFORE any provider fetch.
    const budget = await checkBudget(context.supabase, data.tenant_id);
    if (!budget.allowed) {
      const err = new Error(`AI_BUDGET_EXCEEDED: ${budget.reason}`);
      (err as Error & { code?: string }).code = "AI_BUDGET_EXCEEDED";
      throw err;
    }

    const gatewayBaseUrl = await resolveFviAiBaseUrl(context.supabase);
    const gateway = createFviAiProvider(apiKey, residency, gatewayBaseUrl);
    let summary = "";
    let status: "succeeded" | "failed" | "awaiting_approval" = data.mode === "plan" ? "awaiting_approval" : "succeeded";
    // Redact PII from the agent objective before it leaves the boundary and
    // emit the structured pii.redaction audit row (destination = 'agent').
    const { redactAndAudit } = await import("./pii-redact");
    const safeObjective = await redactAndAudit(data.objective, {
      supabase: context.supabase,
      tenantId: data.tenant_id,
      callerId: context.userId,
      destination: "agent",
    });
    try {
      const sys =
        `You are ReconIQ Reconciliation Agent for tenant "${t.name}". ` +
        `Autonomy: ${data.autonomy}. Mode: ${data.mode}. ` +
        (data.mode === "plan"
          ? "PLAN MODE: do NOT execute mutating tools for real — call them so the system records proposed actions for human review. "
          : "EXECUTE MODE: only act when confident; respect policy ceilings. ") +
        `Scope caps: ${data.max_actions} actions, ${data.max_distinct_tables} distinct tables. ` +
        "Be precise. Cite exception IDs. End with a bulleted summary and concrete next steps.";
      const result = await generateText({
        model: gateway(MODEL_ID),
        system: sys,
        prompt: safeObjective,
        tools,
        stopWhen: stepCountIs(50),
      });
      summary = result.text;
    } catch (e: any) {
      status = "failed";
      summary = `Agent failed: ${e?.message ?? String(e)}`;
    }

    await context.supabase.from("agent_runs").update({
      status, summary, steps,
      planned_actions_count: plannedCount,
      executed_actions_count: executedCount,
      distinct_tables_touched: Array.from(tablesTouched),
    } as any).eq("id", runId);

    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenant_id, scope: "workspace", action: "agent.run",
      resource_type: "agent_run", resource_id: runId,
      context: { objective: data.objective, autonomy: data.autonomy, mode: data.mode, status, executed: executedCount, planned: plannedCount, tables: Array.from(tablesTouched) } as any,
    } as any);

    return { id: runId, status, summary, mode: data.mode, executed: executedCount, planned: plannedCount, steps };
  });

// PR4 — execute reversal for an agent action.
/**
 * Reverse an executed agent action. Extracted from the server-fn handler so
 * integration tests can exercise the same DB path under a real bearer token
 * without re-implementing state restoration.
 *
 * Returns the restored row (when applicable) so callers can assert on it
 * without an extra read.
 */
export async function performAgentActionReversal(
  supabase: any,
  userId: string,
  input: { tenant_id: string; action_id: string; reversal_token: string },
): Promise<{ ok: true; tool: string; restored: any | null }> {
  const { data: act, error } = await supabase.from("agent_actions")
    .select("id, tool, before_state, reversal_token, reverted_at, tenant_id")
    .eq("id", input.action_id).eq("tenant_id", input.tenant_id).single();
  if (error || !act) throw new Error("Action not found");
  if (!act.reversal_token || act.reversal_token !== input.reversal_token)
    throw new Error("Invalid or missing reversal token");
  if (act.reverted_at) throw new Error("Action already reverted");
  const before = act.before_state as any;
  if (!before) throw new Error("No before-state recorded; action is not reversible");

  let restored: any = null;
  switch (act.tool) {
    case "set_break_lifecycle": {
      const { data: row, error: uErr } = await supabase.from("recon_exceptions").update({
        lifecycle_state: before.lifecycle_state, status: before.status,
        root_cause: before.root_cause, resolved_at: before.resolved_at, resolved_by: before.resolved_by,
      } as any).eq("id", before.id).eq("tenant_id", input.tenant_id)
        .select("id, lifecycle_state, status, resolved_at, resolved_by")
        .single();
      if (uErr) throw new Error(uErr.message);
      restored = row;
      break;
    }
    case "add_break_comment": {
      if (before.comment_id) {
        const { error: dErr } = await supabase.from("break_comments")
          .delete().eq("id", before.comment_id).eq("tenant_id", input.tenant_id);
        if (dErr) throw new Error(dErr.message);
      }
      break;
    }
    default:
      throw new Error(`Reversal not implemented for tool "${act.tool}"`);
  }

  await supabase.from("agent_actions").update({
    reverted_at: new Date().toISOString(), reverted_by: userId,
  } as any).eq("id", act.id);

  await supabase.from("audit_log").insert({
    tenant_id: input.tenant_id, scope: "workspace", action: "agent.revert",
    resource_type: "agent_action", resource_id: act.id,
    context: { tool: act.tool } as any,
  } as any);

  await emitAgentReversalEvent(supabase, {
    tenantId: input.tenant_id, userId,
    actionId: act.id, tool: act.tool,
  });

  return { ok: true, tool: act.tool, restored };
}

export const revertAgentAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    action_id: z.string().uuid(),
    reversal_token: z.string().min(8),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    return performAgentActionReversal(context.supabase, context.userId, data);
  });

// Policy CRUD lives in src/lib/agent-policies.functions.ts (single source of truth).

// Phase 1.5 / Fable #5 — production-environment step-up gate. Exposed as a
// thin server fn so the (future) `trigger_reconciliation_run` write tool and
// any human-triggered analog go through the same gate the test suite covers.
export const triggerReconciliationRunAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    recon_definition_id: z.string().uuid(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    await requireProductionRunStepUp(context.supabase, {
      userId: context.userId,
      reconDefinitionId: data.recon_definition_id,
      tenantId: data.tenant_id,
    });
    await enforceHourlyActionLimit(context.supabase, {
      tenantId: data.tenant_id, agentKey: "default",
      actionKind: TOOL_TO_ACTION_KIND.trigger_reconciliation_run,
      userId: context.userId,
    });
    return { ok: true };
  });

/**
 * List agent_actions for a tenant — every tool call performed by the agent.
 * Filterable by action_kind, status, since_hours, and free-text on tool name.
 * RLS scopes rows to the caller's tenant membership.
 */
export const listAgentActions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        tenant_id: z.string().uuid(),
        action_kind: z.string().max(80).optional(),
        status: z.string().max(40).optional(),
        since_hours: z.number().int().min(1).max(24 * 90).default(24 * 7),
        limit: z.number().int().min(1).max(500).default(200),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const since = new Date(Date.now() - data.since_hours * 3600_000).toISOString();
    let q = context.supabase
      .from("agent_actions")
      .select(
        "id, run_id, tool, action_kind, status, policy_ceiling, proposed, approved_by, reverted_at, reverted_by, rejection_reason, input, output, created_at",
      )
      .eq("tenant_id", data.tenant_id)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.action_kind) q = q.eq("action_kind", data.action_kind);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });


