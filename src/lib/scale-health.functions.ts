/**
 * Scale Console — composite processing health for a single tenant.
 *
 * Combines shard-run reliability, silo-tier SLA compliance, and chaos-drill
 * outcomes into one health score (0–100) plus a signal (positive/warning/
 * danger). All reads are tenant-scoped by RLS via requireSupabaseAuth.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const tid = z.string().uuid();

// Static tier SLA table — mirrors silo-ladder-panel TIER_META, kept
// server-side for the compliance computation.
const TIER_SLA_SEC: Record<string, { rpo: number; rto: number }> = {
  shared: { rpo: 3600, rto: 14400 },
  schema: { rpo: 1800, rto: 7200 },
  dedicated_db: { rpo: 900, rto: 3600 },
  dedicated_region: { rpo: 300, rto: 1800 },
  airgapped: { rpo: 0, rto: 0 },
};

export const getScaleHealthSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tid, window_days: z.number().int().min(1).max(90).default(30) }).parse(d))
  .handler(async ({ data, context }) => {
    const since = new Date(Date.now() - data.window_days * 86400_000).toISOString();

    const [shards, assigns, drills] = await Promise.all([
      context.supabase
        .from("recon_shard_runs")
        .select("id,executor_code,status,rows_in,rows_matched,started_at,ended_at")
        .eq("tenant_id", data.tenant_id)
        .gte("started_at", since)
        .order("started_at", { ascending: false })
        .limit(500),
      context.supabase
        .from("tenant_silo_assignments")
        .select("id,silo_tier_code,status,region,activated_at")
        .eq("tenant_id", data.tenant_id),
      context.supabase
        .from("chaos_drills")
        .select("id,drill_code,status,rto_seconds,rpo_seconds,scheduled_for,started_at,ended_at")
        .eq("tenant_id", data.tenant_id)
        .gte("scheduled_for", since)
        .order("scheduled_for", { ascending: false })
        .limit(50),
    ]);

    if (shards.error) throw new Error(shards.error.message);
    if (assigns.error) throw new Error(assigns.error.message);
    if (drills.error) throw new Error(drills.error.message);

    const shardRuns = shards.data ?? [];
    const totalRuns = shardRuns.length;
    const failedRuns = shardRuns.filter((r) => r.status === "failed").length;
    const successRuns = shardRuns.filter((r) => r.status === "succeeded" || r.status === "completed").length;
    const shardSuccessRate = totalRuns > 0 ? successRuns / totalRuns : 1;
    const rowsIn = shardRuns.reduce((a, r) => a + Number(r.rows_in ?? 0), 0);
    const rowsMatched = shardRuns.reduce((a, r) => a + Number(r.rows_matched ?? 0), 0);
    const durations = shardRuns
      .filter((r) => r.started_at && r.ended_at)
      .map((r) => (new Date(r.ended_at as string).getTime() - new Date(r.started_at as string).getTime()) / 1000)
      .filter((d) => d >= 0)
      .sort((a, b) => a - b);
    const p95 = durations.length ? durations[Math.min(durations.length - 1, Math.floor(0.95 * durations.length))] : 0;

    // Per-executor rollup for the shards panel drill-down.
    const byExecutor: Record<string, { total: number; failed: number; queued: number; running: number; rows_in: number; p95_sec: number; durations: number[] }> = {};
    for (const r of shardRuns) {
      const key = String(r.executor_code ?? "unknown");
      const b = byExecutor[key] ?? (byExecutor[key] = { total: 0, failed: 0, queued: 0, running: 0, rows_in: 0, p95_sec: 0, durations: [] });
      b.total += 1;
      if (r.status === "failed") b.failed += 1;
      else if (r.status === "queued" || r.status === "pending") b.queued += 1;
      else if (r.status === "running") b.running += 1;
      b.rows_in += Number(r.rows_in ?? 0);
      if (r.started_at && r.ended_at) {
        const d = (new Date(r.ended_at as string).getTime() - new Date(r.started_at as string).getTime()) / 1000;
        if (d >= 0) b.durations.push(d);
      }
    }
    const executors = Object.entries(byExecutor).map(([code, b]) => {
      const sorted = b.durations.slice().sort((a, c) => a - c);
      const p = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))] : 0;
      // Strip durations before returning to keep payload lean.
      return {
        executor_code: code,
        total: b.total,
        failed: b.failed,
        queued: b.queued,
        running: b.running,
        rows_in: b.rows_in,
        p95_sec: p,
      };
    }).sort((a, b) => b.total - a.total);

    // Silo SLA compliance vs actual chaos.
    const active = (assigns.data ?? []).find((a) => a.status === "active");
    const tierCode = active?.silo_tier_code ?? "shared";
    const sla = TIER_SLA_SEC[tierCode] ?? TIER_SLA_SEC.shared;
    const drillRows = drills.data ?? [];
    const rtoDrills = drillRows.filter((d) => d.rto_seconds != null);
    const rpoDrills = drillRows.filter((d) => d.rpo_seconds != null);
    const avgRto = rtoDrills.length ? rtoDrills.reduce((a, d) => a + Number(d.rto_seconds ?? 0), 0) / rtoDrills.length : null;
    const avgRpo = rpoDrills.length ? rpoDrills.reduce((a, d) => a + Number(d.rpo_seconds ?? 0), 0) / rpoDrills.length : null;
    const rtoCompliance = avgRto != null && sla.rto > 0 ? avgRto <= sla.rto : null;
    const rpoCompliance = avgRpo != null && sla.rpo > 0 ? avgRpo <= sla.rpo : null;
    const drillPass = drillRows.length > 0
      ? drillRows.filter((d) => d.status === "passed" || d.status === "success").length / drillRows.length
      : 1;

    // Composite score (weighted).
    const scoreParts = [
      { key: "shard_success", weight: 0.4, value: shardSuccessRate },
      { key: "drill_pass", weight: 0.3, value: drillPass },
      { key: "rto_sla", weight: 0.15, value: rtoCompliance == null ? 0.8 : rtoCompliance ? 1 : 0.3 },
      { key: "rpo_sla", weight: 0.15, value: rpoCompliance == null ? 0.8 : rpoCompliance ? 1 : 0.3 },
    ];
    const score = Math.round(scoreParts.reduce((a, p) => a + p.weight * p.value * 100, 0));
    const signal: "positive" | "warning" | "danger" =
      score >= 90 ? "positive" : score >= 70 ? "warning" : "danger";

    return {
      window_days: data.window_days,
      score,
      signal,
      score_parts: scoreParts.map((p) => ({ key: p.key, weight: p.weight, value: Math.round(p.value * 100) })),
      shards: {
        total: totalRuns,
        failed: failedRuns,
        success_rate: Math.round(shardSuccessRate * 100),
        rows_in: rowsIn,
        rows_matched: rowsMatched,
        p95_sec: Math.round(p95 * 10) / 10,
        by_executor: executors,
      },
      silo: {
        active_tier: tierCode,
        sla_rpo_sec: sla.rpo,
        sla_rto_sec: sla.rto,
        avg_rto_sec: avgRto != null ? Math.round(avgRto) : null,
        avg_rpo_sec: avgRpo != null ? Math.round(avgRpo) : null,
        rto_compliance: rtoCompliance,
        rpo_compliance: rpoCompliance,
      },
      chaos: {
        drill_count: drillRows.length,
        pass_rate: Math.round(drillPass * 100),
        last_drill: drillRows[0]
          ? {
              drill_code: drillRows[0].drill_code as string,
              status: drillRows[0].status as string,
              scheduled_for: drillRows[0].scheduled_for as string | null,
              rto_seconds: drillRows[0].rto_seconds as number | null,
              rpo_seconds: drillRows[0].rpo_seconds as number | null,
            }
          : null,
      },
    };
  });
