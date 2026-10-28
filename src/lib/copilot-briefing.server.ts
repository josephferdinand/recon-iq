/**
 * ReconIQ Copilot — proactive thread briefing.
 *
 * Runs a parallel read-side batch when a Copilot thread is created (or
 * re-opened) and persists one `copilot_thread_insights` row containing a
 * compact JSON summary the model can quote as the opening context for the
 * first user message.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  slaAtRisk,
  anomalyScan,
  repeatBreakPatterns,
  type TenantScope,
} from "./copilot-tools.server";

export interface ThreadBriefing {
  whoami: { user_id: string; scope: string; tenant_id: string | null };
  open_breaks: number;
  sla_at_risk_today: number;
  anomalies_7d: { matches_dropped: number; latency_p95_ms: number; new_failure_modes: number };
  top_pattern_7d: { pattern_key: string; count: number } | null;
  headline: string;
  generated_at: string;
}

async function countOpenBreaks(
  supabase: SupabaseClient,
  scope: TenantScope,
): Promise<number> {
  let q = supabase
    .from("recon_exceptions")
    .select("id", { count: "exact", head: true })
    .in("status", ["open", "investigating", "pending_review"]);
  if (scope.type === "tenant") q = q.eq("tenant_id", scope.tenantId);
  const { count, error } = await (q as any);
  if (error) return 0;
  return count ?? 0;
}

export async function generateThreadBriefing(
  supabase: SupabaseClient,
  userId: string,
  scope: TenantScope,
  threadScope: "platform" | "tenant" | "workspace",
): Promise<ThreadBriefing> {
  const [openBreaks, sla, anomaly, patterns] = await Promise.all([
    countOpenBreaks(supabase, scope),
    slaAtRisk(supabase, scope, { window: "today", limit: 5 }),
    anomalyScan(supabase, scope, { lookback_days: 7 }),
    repeatBreakPatterns(supabase, scope, { window_days: 7, min_count: 3 }),
  ]);

  const top = patterns[0] ?? null;
  const headlineParts: string[] = [];
  headlineParts.push(`${openBreaks} open breaks`);
  if (sla.breaks_at_risk > 0) {
    headlineParts.push(`${sla.breaks_at_risk} at risk of SLA breach today`);
  }
  if (top) {
    const pct = openBreaks > 0 ? Math.round((top.count / openBreaks) * 100) : 0;
    headlineParts.push(`top reason: ${top.pattern_key} (${pct}%)`);
  }
  if (anomaly.new_failure_modes.length > 0) {
    headlineParts.push(`${anomaly.new_failure_modes.length} new failure mode(s) in 7d`);
  }

  return {
    whoami: {
      user_id: userId,
      scope: threadScope,
      tenant_id: scope.type === "tenant" ? scope.tenantId : null,
    },
    open_breaks: openBreaks,
    sla_at_risk_today: sla.breaks_at_risk,
    anomalies_7d: {
      matches_dropped: anomaly.matches_dropped,
      latency_p95_ms: anomaly.latency_p95,
      new_failure_modes: anomaly.new_failure_modes.length,
    },
    top_pattern_7d: top ? { pattern_key: top.pattern_key, count: top.count } : null,
    headline: headlineParts.join("; ") + ".",
    generated_at: new Date().toISOString(),
  };
}

export async function persistThreadBriefing(
  supabase: SupabaseClient,
  threadId: string,
  tenantId: string | null,
  briefing: ThreadBriefing,
): Promise<void> {
  await supabase.from("copilot_thread_insights").insert({
    thread_id: threadId,
    tenant_id: tenantId,
    insights: briefing as any,
  } as any);
}
