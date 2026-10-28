/**
 * ReconIQ Agent runner — Phase 1.5 gating helpers.
 *
 * Centralizes the five pre-write gates required before any mutating agent
 * tool is exposed:
 *
 *   1. enforceSelfApprovalGuard()       — defense-in-depth on top of the
 *                                          DB trigger `agent_actions_no_self_approve`.
 *   2. enforceBlastRadius()             — hard cap on actions/distinct tables
 *                                          per run, with tenant_admin override.
 *   3. enforceHourlyActionLimit()       — per-(tenant, agent_key, action_kind)
 *                                          cap read from agent_action_hourly_limits.
 *   4. requireProductionRunStepUp()     — step-up grant required when an action
 *                                          would execute against a production
 *                                          reconciliation definition.
 *   5. emitAgentReversalEvent()         — appends a structured security_events row
 *                                          on each reversal so the audit chain
 *                                          captures the actor + token consumption.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// Defaults — Fable spec.
export const BLAST_RADIUS_DEFAULT = { maxActions: 50, maxDistinctTables: 10 };
export const BLAST_RADIUS_ADMIN_OVERRIDE = { maxActions: 500, maxDistinctTables: 50 };

export const PROD_RUN_STEP_UP_KEY = "recon.run.execute.production" as const;

// ──────────────────────────────────────────────────────────────────────────
// 1. Self-approval guard (app-layer mirror of the DB trigger).
// ──────────────────────────────────────────────────────────────────────────
export function enforceSelfApprovalGuard(
  requesterId: string | null | undefined,
  approverId: string | null | undefined,
): void {
  if (!requesterId || !approverId) return;
  if (requesterId === approverId) {
    throw new Error("agent.self_approve_blocked");
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 2. Blast-radius cap (per run).
// ──────────────────────────────────────────────────────────────────────────
export interface BlastRadiusInput {
  plannedActions: number;
  distinctTables: number;
  isTenantAdminOverride?: boolean;
}

export function enforceBlastRadius(input: BlastRadiusInput): void {
  const caps = input.isTenantAdminOverride
    ? BLAST_RADIUS_ADMIN_OVERRIDE
    : BLAST_RADIUS_DEFAULT;
  if (input.plannedActions > caps.maxActions) {
    throw new Error("agent.blast.radius");
  }
  if (input.distinctTables > caps.maxDistinctTables) {
    throw new Error("agent.blast.radius");
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 3. Per-(tenant, agent_key, action_kind) hourly rate-limit.
// ──────────────────────────────────────────────────────────────────────────
export interface HourlyLimitArgs {
  tenantId: string;
  agentKey: string;
  actionKind: string;
}

export async function resolveHourlyLimit(
  supabase: SupabaseClient,
  args: HourlyLimitArgs,
): Promise<number> {
  // Prefer tenant override; fall back to global default.
  const { data } = await (supabase as any)
    .from("agent_action_hourly_limits")
    .select("tenant_id, limit_per_hour")
    .or(`tenant_id.eq.${args.tenantId},tenant_id.is.null`)
    .eq("agent_key", args.agentKey)
    .eq("action_kind", args.actionKind);
  if (!data || data.length === 0) return Infinity;
  // Sort tenant-specific first.
  data.sort((a: any, b: any) => (a.tenant_id ? -1 : 1));
  return data[0]?.limit_per_hour ?? Infinity;
}

/**
 * Count agent_actions in the trailing hour for a given (tenant, action_kind).
 * action_kind is the canonical bucket key (e.g. `resolve_breaks`) — NOT the
 * raw tool name. Multiple tools may map to the same action_kind, so filtering
 * by `tool` would silently under-count and bypass the limit.
 */
export async function countActionsLastHour(
  supabase: SupabaseClient,
  tenantId: string,
  actionKind: string,
): Promise<number> {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await (supabase as any)
    .from("agent_actions")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("action_kind", actionKind)
    .gte("created_at", since);
  return count ?? 0;
}

export async function enforceHourlyActionLimit(
  supabase: SupabaseClient,
  args: HourlyLimitArgs & { userId?: string | null },
): Promise<void> {
  const limit = await resolveHourlyLimit(supabase, args);
  if (!Number.isFinite(limit)) return;
  const used = await countActionsLastHour(supabase, args.tenantId, args.actionKind);
  if (used >= limit) {
    await (supabase as any).from("security_events").insert({
      tenant_id: args.tenantId,
      user_id: args.userId ?? null,
      event_type: "agent.rate_limit",
      severity: "info",
      context: { agent_key: args.agentKey, action_kind: args.actionKind, used, limit },
    });
    throw new Error("agent.rate_limit_exceeded");
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 4. Step-up auth gate for production runs.
// ──────────────────────────────────────────────────────────────────────────
export async function requireProductionRunStepUp(
  supabase: SupabaseClient,
  args: { userId: string; reconDefinitionId: string; tenantId: string },
): Promise<void> {
  const { data: def } = await (supabase as any)
    .from("recon_definitions")
    .select("environment")
    .eq("id", args.reconDefinitionId)
    .eq("tenant_id", args.tenantId)
    .maybeSingle();
  if (!def || def.environment !== "production") return;

  const { data: grant } = await (supabase as any)
    .from("step_up_grants")
    .select("id, expires_at, consumed_at")
    .eq("user_id", args.userId)
    .eq("action_key", PROD_RUN_STEP_UP_KEY)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("granted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!grant) {
    await (supabase as any).from("security_events").insert({
      tenant_id: args.tenantId,
      user_id: args.userId,
      event_type: "agent.step_up_required",
      severity: "warning",
      context: { action_key: PROD_RUN_STEP_UP_KEY, recon_definition_id: args.reconDefinitionId },
    });
    throw new Error("agent.step_up_required");
  }

  await (supabase as any)
    .from("step_up_grants")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", (grant as any).id);
}

// ──────────────────────────────────────────────────────────────────────────
// 5. Structured reversal event.
// ──────────────────────────────────────────────────────────────────────────
export async function emitAgentReversalEvent(
  supabase: SupabaseClient,
  args: { tenantId: string; userId: string; actionId: string; tool: string },
): Promise<void> {
  await (supabase as any).from("security_events").insert({
    tenant_id: args.tenantId,
    user_id: args.userId,
    event_type: "agent.reversal",
    severity: "info",
    context: { action_id: args.actionId, tool: args.tool },
  });
}

// Action-kind → tool mapping used by the hourly limiter so a tool firing in
// agent.functions.ts can resolve which limit row to look up.
export const TOOL_TO_ACTION_KIND: Record<string, string> = {
  set_break_lifecycle: "resolve_breaks",
  add_break_comment: "assign_breaks",
  // Reserved for the future trigger_reconciliation_run write tool.
  trigger_reconciliation_run: "trigger_reconciliation_run",
  // KB CRUD via Copilot — one bucket per action so hourly caps are separate.
  kb_article_create: "kb_article_create",
  kb_article_update: "kb_article_update",
  kb_article_publish: "kb_article_publish",
  kb_article_archive: "kb_article_archive",
};

