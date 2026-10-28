/**
 * ReconIQ Agent — Phase 2 write tools.
 *
 * Three mutating tools + one read-only advice tool, all exposed to the
 * Copilot via `buildCopilotTools()`. Mutating tools NEVER execute inline:
 * they create a `pending` row in `agent_actions` with a single-use
 * `confirmation_token` (5-minute TTL) and return a structured
 * `needs_approval` payload. The client renders Approve / Modify / Cancel.
 * `POST /api/copilot/approve` consumes the token and runs the side-effect.
 *
 * Gates layered on top (centralised in `agent-runner.server.ts`):
 *   - blast-radius (≤100 breaks per write)
 *   - per-(tenant, action_kind) hourly limit
 *   - production-environment step-up auth (trigger_reconciliation_run)
 *   - DB trigger `agent_actions_no_self_approve` (4-eyes)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  enforceBlastRadius,
  enforceHourlyActionLimit,
  enforceSelfApprovalGuard,
  requireProductionRunStepUp,
  TOOL_TO_ACTION_KIND,
} from "./agent-runner.server";

export const CONFIRMATION_TTL_MS = 5 * 60_000;
export const ASSIGN_BREAKS_MAX = 100;
export const RESOLVE_BREAKS_MAX = 100;

export type WriteTool =
  | "assign_breaks"
  | "resolve_breaks"
  | "trigger_reconciliation_run"
  | "kb_article_create"
  | "kb_article_update"
  | "kb_article_publish"
  | "kb_article_archive";


export interface PendingApproval {
  status: "awaiting_approval";
  action_id: string;
  confirmation_token: string;
  expires_at: string;
  tool: WriteTool;
  description: string;
  preview: Record<string, unknown>;
}

export interface CompletedAction {
  status: "completed";
  action_id: string;
  tool: WriteTool;
  result: Record<string, unknown>;
}

/**
 * Ensures an `agent_runs` row exists for this copilot thread (one per
 * thread). All write-tool actions emitted in the thread are tied to it.
 */
export async function ensureAgentRunForThread(
  supabase: SupabaseClient,
  args: { tenantId: string; userId: string; threadId: string },
): Promise<string> {
  const objective = `copilot-thread:${args.threadId}`;
  const { data: existing } = await (supabase as any)
    .from("agent_runs")
    .select("id")
    .eq("tenant_id", args.tenantId)
    .eq("user_id", args.userId)
    .eq("objective", objective)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data: ins, error } = await (supabase as any)
    .from("agent_runs")
    .insert({
      tenant_id: args.tenantId,
      user_id: args.userId,
      scope: "workspace",
      objective,
      mode: "execute",
      status: "running",
      steps: [],
    })
    .select("id")
    .single();
  if (error || !ins) throw new Error(error?.message ?? "agent_run create failed");
  return ins.id as string;
}

async function createPendingAction(
  supabase: SupabaseClient,
  args: {
    runId: string;
    tenantId: string;
    tool: WriteTool;
    input: unknown;
    beforeState?: unknown;
  },
): Promise<{ actionId: string; token: string; expiresAt: string }> {
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + CONFIRMATION_TTL_MS).toISOString();
  const { data, error } = await (supabase as any)
    .from("agent_actions")
    .insert({
      run_id: args.runId,
      tenant_id: args.tenantId,
      tool: args.tool,
      action_kind: TOOL_TO_ACTION_KIND[args.tool] ?? args.tool,
      input: args.input as any,
      status: "pending",
      proposed: true,
      policy_ceiling: "assist",
      before_state: (args.beforeState ?? null) as any,
      confirmation_token: token,
      confirmation_expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "pending action insert failed");
  return { actionId: data.id as string, token, expiresAt };
}

// ──────────────────────────────────────────────────────────────────────
// Tool 1: assign_breaks
// ──────────────────────────────────────────────────────────────────────
export async function assignBreaks(
  supabase: SupabaseClient,
  args: {
    tenantId: string;
    runId: string;
    breakIds: string[];
    assigneeUserId: string;
    requesterUserId: string;
    needsApproval: boolean;
  },
): Promise<PendingApproval | CompletedAction> {
  if (args.breakIds.length === 0) throw new Error("agent.assign_breaks.empty");
  enforceBlastRadius({ plannedActions: args.breakIds.length, distinctTables: 1 });
  if (args.breakIds.length > ASSIGN_BREAKS_MAX) throw new Error("agent.blast.radius");

  // Fail-fast: assignee must be an active tenant member.
  const { data: member } = await (supabase as any)
    .from("tenant_members")
    .select("user_id, active")
    .eq("tenant_id", args.tenantId)
    .eq("user_id", args.assigneeUserId)
    .maybeSingle();
  if (!member || member.active === false) throw new Error("agent.assignee_not_member");

  const input = {
    break_ids: args.breakIds,
    assignee_user_id: args.assigneeUserId,
  };

  if (args.needsApproval) {
    const { actionId, token, expiresAt } = await createPendingAction(supabase, {
      runId: args.runId,
      tenantId: args.tenantId,
      tool: "assign_breaks",
      input,
    });
    return {
      status: "awaiting_approval",
      action_id: actionId,
      confirmation_token: token,
      expires_at: expiresAt,
      tool: "assign_breaks",
      description: `Assign ${args.breakIds.length} break(s) to user ${args.assigneeUserId}.`,
      preview: input,
    };
  }

  // Admin override path — execute immediately.
  await enforceHourlyActionLimit(supabase, {
    tenantId: args.tenantId,
    agentKey: "default",
    actionKind: TOOL_TO_ACTION_KIND.assign_breaks,
    userId: args.requesterUserId,
  });
  const { error: uErr } = await (supabase as any)
    .from("recon_exceptions")
    .update({ assignee: args.assigneeUserId, assigned_by: args.requesterUserId, assigned_at: new Date().toISOString() })
    .in("id", args.breakIds)
    .eq("tenant_id", args.tenantId);
  if (uErr) throw new Error(uErr.message);
  const { data: ins } = await (supabase as any)
    .from("agent_actions")
    .insert({
      run_id: args.runId,
      tenant_id: args.tenantId,
      tool: "assign_breaks",
      action_kind: TOOL_TO_ACTION_KIND.assign_breaks,
      input: input as any,
      status: "completed",
      proposed: false,
      policy_ceiling: "assist",
    })
    .select("id")
    .single();
  await (supabase as any).from("security_events").insert({
    tenant_id: args.tenantId,
    user_id: args.requesterUserId,
    event_type: "agent.break_assigned",
    severity: "info",
    context: { count: args.breakIds.length, assignee: args.assigneeUserId },
  });
  return {
    status: "completed",
    action_id: ins?.id ?? "",
    tool: "assign_breaks",
    result: { assigned: args.breakIds.length },
  };
}

// ──────────────────────────────────────────────────────────────────────
// Tool 2: resolve_breaks — ALWAYS needs approval (no admin override).
// ──────────────────────────────────────────────────────────────────────
export const RESOLUTION_CODES = ["matched", "written_off", "timing", "duplicate"] as const;
export type ResolutionCode = (typeof RESOLUTION_CODES)[number];

export async function resolveBreaks(
  supabase: SupabaseClient,
  args: {
    tenantId: string;
    runId: string;
    breakIds: string[];
    resolutionCode: ResolutionCode;
    note: string;
  },
): Promise<PendingApproval> {
  if (args.breakIds.length === 0) throw new Error("agent.resolve_breaks.empty");
  if (!args.note || args.note.trim().length < 4) throw new Error("agent.resolve_breaks.note_required");
  enforceBlastRadius({ plannedActions: args.breakIds.length, distinctTables: 1 });
  if (args.breakIds.length > RESOLVE_BREAKS_MAX) throw new Error("agent.blast.radius");

  const { data: prev } = await (supabase as any)
    .from("recon_exceptions")
    .select("id, lifecycle_state, status")
    .in("id", args.breakIds)
    .eq("tenant_id", args.tenantId);

  const input = {
    break_ids: args.breakIds,
    resolution_code: args.resolutionCode,
    note: args.note,
  };
  const { actionId, token, expiresAt } = await createPendingAction(supabase, {
    runId: args.runId,
    tenantId: args.tenantId,
    tool: "resolve_breaks",
    input,
    beforeState: { rows: prev ?? [] },
  });
  return {
    status: "awaiting_approval",
    action_id: actionId,
    confirmation_token: token,
    expires_at: expiresAt,
    tool: "resolve_breaks",
    description: `Resolve ${args.breakIds.length} break(s) as "${args.resolutionCode}".`,
    preview: input,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Tool 3: trigger_reconciliation_run.
// ──────────────────────────────────────────────────────────────────────
export async function triggerReconciliationRun(
  supabase: SupabaseClient,
  args: {
    tenantId: string;
    runId: string;
    reconDefinitionId: string;
    requesterUserId: string;
  },
): Promise<PendingApproval> {
  // Blast-radius pre-check (a single run = 1 action, 1 table).
  enforceBlastRadius({ plannedActions: 1, distinctTables: 1 });
  await enforceHourlyActionLimit(supabase, {
    tenantId: args.tenantId,
    agentKey: "default",
    actionKind: TOOL_TO_ACTION_KIND.trigger_reconciliation_run,
    userId: args.requesterUserId,
  });
  // Production-environment step-up (idempotent for non-prod).
  await requireProductionRunStepUp(supabase, {
    userId: args.requesterUserId,
    reconDefinitionId: args.reconDefinitionId,
    tenantId: args.tenantId,
  });
  const input = { recon_definition_id: args.reconDefinitionId };
  const { actionId, token, expiresAt } = await createPendingAction(supabase, {
    runId: args.runId,
    tenantId: args.tenantId,
    tool: "trigger_reconciliation_run",
    input,
  });
  return {
    status: "awaiting_approval",
    action_id: actionId,
    confirmation_token: token,
    expires_at: expiresAt,
    tool: "trigger_reconciliation_run",
    description: `Trigger a new reconciliation run for definition ${args.reconDefinitionId}.`,
    preview: input,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Tool 4: recommend_fix (advice only, no DB mutation).
// ──────────────────────────────────────────────────────────────────────
export interface RecommendFixSuggestion {
  root_cause: string;
  similar_resolved_count: number;
  rule_suggestion: string;
  confidence: number;
}

export async function recommendFix(
  supabase: SupabaseClient,
  args: { tenantId: string; exceptionId: string },
): Promise<{ suggestions: RecommendFixSuggestion[] }> {
  const { data: exc } = await (supabase as any)
    .from("recon_exceptions")
    .select("id, run_id, reason, side, payload")
    .eq("id", args.exceptionId)
    .eq("tenant_id", args.tenantId)
    .maybeSingle();
  if (!exc) return { suggestions: [] };

  // 1. Root-cause clusters that match the reason.
  const { data: causes } = await (supabase as any)
    .from("break_root_causes")
    .select("label, category, occurrence_count, confidence")
    .eq("tenant_id", args.tenantId)
    .order("occurrence_count", { ascending: false })
    .limit(5);

  // 2. Similar resolved breaks in the last 90 days.
  const since = new Date(Date.now() - 90 * 86400e3).toISOString();
  const { data: similar } = await (supabase as any)
    .from("recon_exceptions")
    .select("id, root_cause, resolution_note")
    .eq("tenant_id", args.tenantId)
    .eq("status", "resolved")
    .gte("resolved_at", since)
    .ilike("reason", `%${(exc.reason ?? "").slice(0, 40)}%`)
    .limit(50);
  const similarCount = (similar ?? []).length;

  // 3. Rules from the linked recon_definition.
  let ruleSuggestion = "Review tolerance bands and key-mapping for the linked rule.";
  if (exc.run_id) {
    const { data: run } = await (supabase as any)
      .from("recon_runs")
      .select("definition_id")
      .eq("id", exc.run_id)
      .maybeSingle();
    if (run?.definition_id) {
      const { data: def } = await (supabase as any)
        .from("recon_definitions")
        .select("rules, name")
        .eq("id", run.definition_id)
        .maybeSingle();
      const rules = (def?.rules ?? null) as { tolerance?: unknown; keys?: unknown } | null;
      if (rules && typeof rules === "object") {
        ruleSuggestion = `Inspect rule on "${def?.name ?? "definition"}" — ${JSON.stringify(rules).slice(0, 200)}`;
      }
    }
  }

  const out: RecommendFixSuggestion[] = (causes ?? []).map((c: any) => ({
    root_cause: `${c.category ?? "unknown"}: ${c.label ?? "unlabelled"}`,
    similar_resolved_count: similarCount,
    rule_suggestion: ruleSuggestion,
    confidence: Number(c.confidence ?? 0.5),
  }));
  if (out.length === 0) {
    out.push({
      root_cause: "No prior cluster matched. Inspect raw payload manually.",
      similar_resolved_count: similarCount,
      rule_suggestion: ruleSuggestion,
      confidence: 0.2,
    });
  }
  return { suggestions: out };
}

// ══════════════════════════════════════════════════════════════════════
// KB CRUD write tools — same pending/approval pattern as break writes.
// Every proposal requires tenant_admin or platform_admin at PROPOSAL time.
// Approval flow enforces 4-eyes (approver ≠ requester).
// ══════════════════════════════════════════════════════════════════════

const KB_TITLE_MAX = 200;
const KB_SUMMARY_MAX = 500;
const KB_BODY_MAX = 50_000;

async function assertKbAuthor(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string | null,
): Promise<void> {
  const { data: isPlat } = await (supabase as any).rpc("is_platform_admin", { _user_id: userId });
  if (isPlat) return;
  if (!tenantId) throw new Error("agent.kb.forbidden");
  const { data: isTAdmin } = await (supabase as any).rpc("has_tenant_role", {
    _user_id: userId,
    _tenant_id: tenantId,
    _role: "tenant_admin",
  });
  if (!isTAdmin) throw new Error("agent.kb.forbidden");
}

function kbSlugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

export interface KbArticleCreateInput {
  scope: "platform" | "tenant";
  title: string;
  summary?: string | null;
  body_md: string;
  category_id?: string | null;
  publish_immediately?: boolean;
}

export async function proposeKbArticleCreate(
  supabase: SupabaseClient,
  args: { tenantId: string; runId: string; requesterUserId: string; input: KbArticleCreateInput },
): Promise<PendingApproval> {
  await assertKbAuthor(supabase, args.requesterUserId, args.tenantId);
  if (!args.input.title || args.input.title.trim().length < 2) throw new Error("agent.kb.title_required");
  if ((args.input.body_md ?? "").length > KB_BODY_MAX) throw new Error("agent.kb.body_too_long");
  if (args.input.title.length > KB_TITLE_MAX) throw new Error("agent.kb.title_too_long");
  if ((args.input.summary ?? "").length > KB_SUMMARY_MAX) throw new Error("agent.kb.summary_too_long");

  const input = {
    scope: args.input.scope,
    title: args.input.title.trim(),
    summary: args.input.summary ?? null,
    body_md: args.input.body_md ?? "",
    category_id: args.input.category_id ?? null,
    publish_immediately: !!args.input.publish_immediately,
  };
  const { actionId, token, expiresAt } = await createPendingAction(supabase, {
    runId: args.runId,
    tenantId: args.tenantId,
    tool: "kb_article_create",
    input,
  });
  // Fire-and-forget approver notifications.
  void (async () => {
    const { notifyKbApprovers } = await import("./approval-notifications.server");
    await notifyKbApprovers(supabase, {
      tenantId: args.tenantId, tool: "kb_article_create", actionId,
      requesterUserId: args.requesterUserId, scope: input.scope,
      title: input.title, summary: input.summary,
    });
  })();
  return {
    status: "awaiting_approval",
    action_id: actionId,
    confirmation_token: token,
    expires_at: expiresAt,
    tool: "kb_article_create",
    description: `Create ${input.scope} KB article "${input.title}"${input.publish_immediately ? " (published)" : " (draft)"}.`,
    preview: input,
  };
}

export interface KbArticleUpdateInput {
  article_id: string;
  title?: string;
  summary?: string | null;
  body_md?: string;
  category_id?: string | null;
}

export async function proposeKbArticleUpdate(
  supabase: SupabaseClient,
  args: { tenantId: string; runId: string; requesterUserId: string; input: KbArticleUpdateInput },
): Promise<PendingApproval> {
  await assertKbAuthor(supabase, args.requesterUserId, args.tenantId);
  const { data: existing, error } = await (supabase as any)
    .from("kb_articles")
    .select("id, tenant_id, scope, title, summary, body_md, category_id, status")
    .eq("id", args.input.article_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!existing) throw new Error("agent.kb.article_not_found");
  // Scope check: tenant articles must belong to caller's tenant; platform-scope
  // articles require platform_admin (assertKbAuthor already allowed platform).
  if (existing.scope === "tenant" && existing.tenant_id !== args.tenantId) {
    throw new Error("agent.kb.forbidden");
  }
  if (args.input.title && args.input.title.length > KB_TITLE_MAX) throw new Error("agent.kb.title_too_long");
  if ((args.input.body_md ?? "").length > KB_BODY_MAX) throw new Error("agent.kb.body_too_long");

  const patch: Record<string, unknown> = { article_id: args.input.article_id };
  if (args.input.title !== undefined) patch.title = args.input.title.trim();
  if (args.input.summary !== undefined) patch.summary = args.input.summary;
  if (args.input.body_md !== undefined) patch.body_md = args.input.body_md;
  if (args.input.category_id !== undefined) patch.category_id = args.input.category_id;

  const { actionId, token, expiresAt } = await createPendingAction(supabase, {
    runId: args.runId,
    tenantId: args.tenantId,
    tool: "kb_article_update",
    input: patch,
    beforeState: {
      title: existing.title,
      summary: existing.summary,
      category_id: existing.category_id,
      body_md_len: (existing.body_md ?? "").length,
    },
  });
  void (async () => {
    const { notifyKbApprovers } = await import("./approval-notifications.server");
    await notifyKbApprovers(supabase, {
      tenantId: args.tenantId, tool: "kb_article_update", actionId,
      requesterUserId: args.requesterUserId, scope: existing.scope,
      title: existing.title,
    });
  })();
  return {
    status: "awaiting_approval",
    action_id: actionId,
    confirmation_token: token,
    expires_at: expiresAt,
    tool: "kb_article_update",
    description: `Update KB article "${existing.title}".`,
    preview: patch,
  };
}

export async function proposeKbArticlePublish(
  supabase: SupabaseClient,
  args: { tenantId: string; runId: string; requesterUserId: string; articleId: string; publish: boolean },
): Promise<PendingApproval> {
  await assertKbAuthor(supabase, args.requesterUserId, args.tenantId);
  const { data: existing } = await (supabase as any)
    .from("kb_articles")
    .select("id, tenant_id, scope, title, status")
    .eq("id", args.articleId)
    .maybeSingle();
  if (!existing) throw new Error("agent.kb.article_not_found");
  if (existing.scope === "tenant" && existing.tenant_id !== args.tenantId) {
    throw new Error("agent.kb.forbidden");
  }
  const input = { article_id: args.articleId, publish: args.publish };
  const { actionId, token, expiresAt } = await createPendingAction(supabase, {
    runId: args.runId,
    tenantId: args.tenantId,
    tool: "kb_article_publish",
    input,
    beforeState: { status: existing.status },
  });
  void (async () => {
    const { notifyKbApprovers } = await import("./approval-notifications.server");
    await notifyKbApprovers(supabase, {
      tenantId: args.tenantId, tool: "kb_article_publish", actionId,
      requesterUserId: args.requesterUserId, scope: existing.scope,
      title: existing.title,
    });
  })();
  return {
    status: "awaiting_approval",
    action_id: actionId,
    confirmation_token: token,
    expires_at: expiresAt,
    tool: "kb_article_publish",
    description: `${args.publish ? "Publish" : "Unpublish (draft)"} KB article "${existing.title}".`,
    preview: input,
  };
}

export async function proposeKbArticleArchive(
  supabase: SupabaseClient,
  args: { tenantId: string; runId: string; requesterUserId: string; articleId: string },
): Promise<PendingApproval> {
  await assertKbAuthor(supabase, args.requesterUserId, args.tenantId);
  const { data: existing } = await (supabase as any)
    .from("kb_articles")
    .select("id, tenant_id, scope, title, status")
    .eq("id", args.articleId)
    .maybeSingle();
  if (!existing) throw new Error("agent.kb.article_not_found");
  if (existing.scope === "tenant" && existing.tenant_id !== args.tenantId) {
    throw new Error("agent.kb.forbidden");
  }
  const input = { article_id: args.articleId };
  const { actionId, token, expiresAt } = await createPendingAction(supabase, {
    runId: args.runId,
    tenantId: args.tenantId,
    tool: "kb_article_archive",
    input,
    beforeState: { status: existing.status, title: existing.title },
  });
  void (async () => {
    const { notifyKbApprovers } = await import("./approval-notifications.server");
    await notifyKbApprovers(supabase, {
      tenantId: args.tenantId, tool: "kb_article_archive", actionId,
      requesterUserId: args.requesterUserId, scope: existing.scope,
      title: existing.title,
    });
  })();
  return {
    status: "awaiting_approval",
    action_id: actionId,
    confirmation_token: token,
    expires_at: expiresAt,
    tool: "kb_article_archive",
    description: `Archive KB article "${existing.title}".`,
    preview: input,
  };
}



// ──────────────────────────────────────────────────────────────────────
// Approve / consume a confirmation token and execute the side-effect.
// ──────────────────────────────────────────────────────────────────────
export interface ApprovalResult {
  ok: true;
  action_id: string;
  tool: WriteTool;
  result: Record<string, unknown>;
}

export async function executeConfirmedAction(
  supabase: SupabaseClient,
  approverUserId: string,
  args: { tenantId: string; actionId: string; confirmationToken: string },
): Promise<ApprovalResult> {
  const { data: act, error } = await (supabase as any)
    .from("agent_actions")
    .select(
      "id, run_id, tenant_id, tool, input, status, confirmation_token, confirmation_expires_at, confirmed_at, before_state, agent_runs:agent_runs!inner(user_id)",
    )
    .eq("id", args.actionId)
    .eq("tenant_id", args.tenantId)
    .single();
  if (error || !act) throw new Error("agent.action_not_found");
  if (act.confirmed_at) throw new Error("agent.token_already_used");
  if (act.status !== "pending") throw new Error("agent.action_not_pending");
  if (!act.confirmation_token || act.confirmation_token !== args.confirmationToken)
    throw new Error("agent.token_invalid");
  if (!act.confirmation_expires_at || new Date(act.confirmation_expires_at).getTime() < Date.now())
    throw new Error("agent.token_expired");

  const requesterId = (act as any).agent_runs?.user_id as string | undefined;
  enforceSelfApprovalGuard(requesterId, approverUserId);

  // Per-(tenant, action_kind) hourly cap is enforced at approval time, when
  // the actual mutation lands. This way pending proposals that never get
  // approved don't burn the bucket.
  await enforceHourlyActionLimit(supabase, {
    tenantId: args.tenantId,
    agentKey: "default",
    actionKind: TOOL_TO_ACTION_KIND[act.tool] ?? act.tool,
    userId: approverUserId,
  });

  let result: Record<string, unknown> = {};
  switch (act.tool as WriteTool) {
    case "assign_breaks": {
      const input = act.input as { break_ids: string[]; assignee_user_id: string };
      const { error: uErr } = await (supabase as any)
        .from("recon_exceptions")
        .update({
          assignee: input.assignee_user_id,
          assigned_by: approverUserId,
          assigned_at: new Date().toISOString(),
        })
        .in("id", input.break_ids)
        .eq("tenant_id", args.tenantId);
      if (uErr) throw new Error(uErr.message);
      result = { assigned: input.break_ids.length };
      await (supabase as any).from("security_events").insert({
        tenant_id: args.tenantId,
        user_id: approverUserId,
        event_type: "agent.break_assigned",
        severity: "info",
        context: { count: input.break_ids.length, assignee: input.assignee_user_id, action_id: act.id },
      });
      break;
    }
    case "resolve_breaks": {
      const input = act.input as { break_ids: string[]; resolution_code: ResolutionCode; note: string };
      const lifecycleState = input.resolution_code === "written_off" ? "written_off" : "resolved";
      const status = input.resolution_code === "written_off" ? "wont_fix" : "resolved";
      const { error: uErr } = await (supabase as any)
        .from("recon_exceptions")
        .update({
          lifecycle_state: lifecycleState,
          status,
          resolution_note: `[Agent/${input.resolution_code}] ${input.note}`,
          resolved_by: approverUserId,
          resolved_at: new Date().toISOString(),
        })
        .in("id", input.break_ids)
        .eq("tenant_id", args.tenantId);
      if (uErr) throw new Error(uErr.message);
      result = { resolved: input.break_ids.length, code: input.resolution_code };
      await (supabase as any).from("security_events").insert({
        tenant_id: args.tenantId,
        user_id: approverUserId,
        event_type: "agent.break_resolved",
        severity: "info",
        context: { count: input.break_ids.length, code: input.resolution_code, action_id: act.id },
      });
      break;
    }
    case "trigger_reconciliation_run": {
      const input = act.input as { recon_definition_id: string };
      const { data: runIns, error: rErr } = await (supabase as any)
        .from("recon_runs")
        .insert({
          tenant_id: args.tenantId,
          definition_id: input.recon_definition_id,
          status: "queued",
          started_at: new Date().toISOString(),
          run_by: approverUserId,
          stats: { triggered_by: "agent", agent_action_id: act.id } as any,
        })
        .select("id")
        .single();
      if (rErr) throw new Error(rErr.message);
      result = { recon_run_id: runIns?.id };
      await (supabase as any).from("security_events").insert({
        tenant_id: args.tenantId,
        user_id: approverUserId,
        event_type: "agent.run_triggered",
        severity: "info",
        context: { recon_definition_id: input.recon_definition_id, recon_run_id: runIns?.id, action_id: act.id },
      });
      break;
    }
    case "kb_article_create": {
      const input = act.input as KbArticleCreateInput;
      const slug = kbSlugify(input.title) + "-" + Math.random().toString(36).slice(2, 6);
      const { data: ins, error: kErr } = await (supabase as any)
        .from("kb_articles")
        .insert({
          scope: input.scope,
          tenant_id: input.scope === "tenant" ? args.tenantId : null,
          title: input.title,
          summary: input.summary ?? null,
          body_md: input.body_md ?? "",
          category_id: input.category_id ?? null,
          status: input.publish_immediately ? "published" : "draft",
          slug,
          author_id: approverUserId,
        })
        .select("id, slug, status")
        .single();
      if (kErr) throw new Error(kErr.message);
      result = { article_id: ins.id, slug: ins.slug, status: ins.status };
      break;
    }
    case "kb_article_update": {
      const patch = act.input as { article_id: string } & Partial<KbArticleUpdateInput>;
      const update: Record<string, unknown> = { author_id: approverUserId };
      if (patch.title !== undefined) update.title = patch.title;
      if (patch.summary !== undefined) update.summary = patch.summary;
      if (patch.body_md !== undefined) update.body_md = patch.body_md;
      if (patch.category_id !== undefined) update.category_id = patch.category_id;
      const { error: kErr } = await (supabase as any)
        .from("kb_articles").update(update).eq("id", patch.article_id);
      if (kErr) throw new Error(kErr.message);
      result = { article_id: patch.article_id, updated_fields: Object.keys(update).filter((k) => k !== "author_id") };
      break;
    }
    case "kb_article_publish": {
      const input = act.input as { article_id: string; publish: boolean };
      const { error: kErr } = await (supabase as any)
        .from("kb_articles")
        .update({ status: input.publish ? "published" : "draft", author_id: approverUserId })
        .eq("id", input.article_id);
      if (kErr) throw new Error(kErr.message);
      result = { article_id: input.article_id, status: input.publish ? "published" : "draft" };
      break;
    }
    case "kb_article_archive": {
      const input = act.input as { article_id: string };
      const { error: kErr } = await (supabase as any)
        .from("kb_articles")
        .update({ status: "archived", author_id: approverUserId })
        .eq("id", input.article_id);
      if (kErr) throw new Error(kErr.message);
      result = { article_id: input.article_id, status: "archived" };
      break;
    }
    default:
      throw new Error(`agent.unsupported_tool:${act.tool}`);

  }

  await (supabase as any)
    .from("agent_actions")
    .update({
      status: "completed",
      approved_by: approverUserId,
      confirmed_at: new Date().toISOString(),
      output: result as any,
    })
    .eq("id", act.id);

  await (supabase as any).from("audit_log").insert({
    tenant_id: args.tenantId,
    scope: "workspace",
    action: `agent.${act.tool}.executed`,
    resource_type: "agent_action",
    resource_id: act.id,
    context: { result } as any,
  });

  return { ok: true, action_id: act.id, tool: act.tool as WriteTool, result };
}

export async function cancelPendingAction(
  supabase: SupabaseClient,
  approverUserId: string,
  args: { tenantId: string; actionId: string; reason?: string },
): Promise<{ ok: true }> {
  const { error } = await (supabase as any)
    .from("agent_actions")
    .update({
      status: "rejected",
      rejection_reason: args.reason ?? "user_cancelled",
      approved_by: approverUserId,
      confirmation_token: null,
    })
    .eq("id", args.actionId)
    .eq("tenant_id", args.tenantId)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
  return { ok: true };
}
