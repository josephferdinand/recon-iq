// ─────────────────────────────────────────────────────────────────────────────
// Per-tenant ingestion pipeline dashboard.
// Aggregates ingestion runs across data sources, ERP connectors, parsers, and
// data-prep pipelines. Tenant-scoped: RLS gates the reads server-side, and
// we additionally assert has_tenant_role / is_platform_admin for a clean 403.
// ─────────────────────────────────────────────────────────────────────────────
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertTenantAccess(ctx: any, tenantId: string) {
  const [{ data: plat }, { data: mem }] = await Promise.all([
    ctx.supabase.rpc("is_platform_admin", { _user_id: ctx.userId }),
    ctx.supabase.rpc("is_tenant_member", { _user_id: ctx.userId, _tenant_id: tenantId }),
  ]);
  if (!plat && !mem) throw new Error("Forbidden");
}

type Bucket = { label: string; total: number; ok: number; fail: number; running: number; last_at: string | null; rows: number };

function bucketize(rows: any[], statusMap: { ok: string[]; fail: string[]; running: string[] }, rowField?: string): Bucket {
  const ok = rows.filter((r) => statusMap.ok.includes(r.status)).length;
  const fail = rows.filter((r) => statusMap.fail.includes(r.status)).length;
  const running = rows.filter((r) => statusMap.running.includes(r.status)).length;
  const last = rows.reduce<string | null>((a, r) => {
    const t = r.finished_at ?? r.completed_at ?? r.started_at ?? null;
    return t && (!a || t > a) ? t : a;
  }, null);
  const rowsCount = rowField ? rows.reduce((a, r) => a + Number(r[rowField] ?? 0), 0) : 0;
  return { label: "", total: rows.length, ok, fail, running, last_at: last, rows: rowsCount };
}

export const getTenantPipelineDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      window_minutes: z.number().int().min(15).max(43200).default(1440), // default 24h
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAccess(context, data.tenant_id);
    const since = new Date(Date.now() - data.window_minutes * 60_000).toISOString();
    const sb = context.supabase;

    const [dsRuns, erpRuns, parseRuns, prepRuns, alerts, health] = await Promise.all([
      sb.from("data_source_runs")
        .select("id, schedule_id, status, rows_ingested, error, started_at, finished_at, trigger")
        .eq("tenant_id", data.tenant_id).gte("started_at", since)
        .order("started_at", { ascending: false }).limit(500),
      sb.from("erp_connector_runs")
        .select("id, connector_id, connector_kind, status, rows_fetched, bytes_transferred, error, started_at, completed_at, duration_ms, trigger_kind")
        .eq("tenant_id", data.tenant_id).gte("started_at", since)
        .order("started_at", { ascending: false }).limit(500),
      sb.from("parser_runs")
        .select("id, definition_id, status, messages_out, errors_count, bytes_in, error_summary, started_at, finished_at, source_filename")
        .eq("tenant_id", data.tenant_id).gte("started_at", since)
        .order("started_at", { ascending: false }).limit(500),
      sb.from("data_prep_runs")
        .select("id, pipeline_id, status, rows_in, rows_out, error, started_at, finished_at, trigger, pipeline_lifecycle")
        .eq("tenant_id", data.tenant_id).gte("started_at", since)
        .order("started_at", { ascending: false }).limit(500),
      sb.from("data_source_alerts")
        .select("id, data_source_id, severity, alert_type, message, created_at, acknowledged_at")
        .eq("tenant_id", data.tenant_id).gte("created_at", since)
        .order("created_at", { ascending: false }).limit(200),
      sb.from("data_source_health")
        .select("data_source_id, observed_at, status, row_count, null_ratio, schema_drift, latency_seconds, volume_anomaly_score")
        .eq("tenant_id", data.tenant_id).gte("observed_at", since)
        .order("observed_at", { ascending: false }).limit(500),
    ]);

    const err = dsRuns.error ?? erpRuns.error ?? parseRuns.error ?? prepRuns.error ?? alerts.error ?? health.error;
    if (err) throw new Error(err.message);

    // Latest health per data_source_id.
    const latestHealth = new Map<string, any>();
    for (const h of health.data ?? []) {
      if (!latestHealth.has(h.data_source_id)) latestHealth.set(h.data_source_id, h);
    }

    const dsBucket = bucketize(dsRuns.data ?? [], {
      ok: ["success"], fail: ["failed", "error"], running: ["running", "queued"],
    }, "rows_ingested");
    const erpBucket = bucketize(erpRuns.data ?? [], {
      ok: ["success", "completed"], fail: ["failed", "error"], running: ["running", "queued"],
    }, "rows_fetched");
    const parseBucket = bucketize(parseRuns.data ?? [], {
      ok: ["succeeded", "success", "completed"], fail: ["failed", "error"], running: ["running", "pending", "queued"],
    }, "messages_out");
    const prepBucket = bucketize(prepRuns.data ?? [], {
      ok: ["success", "completed"], fail: ["failed", "error"], running: ["running", "queued"],
    }, "rows_out");

    const erpLatencies = (erpRuns.data ?? []).map((r: any) => Number(r.duration_ms ?? 0)).filter((n: number) => n > 0).sort((a: number, b: number) => a - b);
    const p50 = erpLatencies.length ? erpLatencies[Math.floor(erpLatencies.length * 0.5)] : 0;
    const p95 = erpLatencies.length ? erpLatencies[Math.floor(erpLatencies.length * 0.95)] : 0;

    const unackedAlerts = (alerts.data ?? []).filter((a: any) => !a.acknowledged_at);

    // Failures (most recent 25 across all sources).
    const failures = [
      ...(dsRuns.data ?? []).filter((r: any) => ["failed","error"].includes(r.status)).map((r: any) => ({
        source: "data_source", id: r.id, ref: r.schedule_id, status: r.status,
        error: r.error, at: r.finished_at ?? r.started_at,
      })),
      ...(erpRuns.data ?? []).filter((r: any) => ["failed","error"].includes(r.status)).map((r: any) => ({
        source: "erp_connector", id: r.id, ref: `${r.connector_kind}/${r.connector_id.slice(0,8)}`, status: r.status,
        error: r.error, at: r.completed_at ?? r.started_at,
      })),
      ...(parseRuns.data ?? []).filter((r: any) => ["failed","error"].includes(r.status)).map((r: any) => ({
        source: "parser", id: r.id, ref: r.source_filename ?? r.definition_id, status: r.status,
        error: r.error_summary, at: r.finished_at ?? r.started_at,
      })),
      ...(prepRuns.data ?? []).filter((r: any) => ["failed","error"].includes(r.status)).map((r: any) => ({
        source: "data_prep", id: r.id, ref: r.pipeline_id, status: r.status,
        error: r.error, at: r.finished_at ?? r.started_at,
      })),
    ].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")).slice(0, 25);

    return {
      window_minutes: data.window_minutes,
      since,
      data_sources: dsBucket,
      erp_connectors: { ...erpBucket, p50_ms: p50, p95_ms: p95 },
      parsers: parseBucket,
      data_prep: prepBucket,
      alerts: {
        total: (alerts.data ?? []).length,
        unacknowledged: unackedAlerts.length,
        by_severity: (alerts.data ?? []).reduce((acc: Record<string, number>, a: any) => {
          acc[a.severity] = (acc[a.severity] ?? 0) + 1; return acc;
        }, {}),
        recent: (alerts.data ?? []).slice(0, 20),
      },
      health: {
        sources_observed: latestHealth.size,
        with_drift: [...latestHealth.values()].filter((h) => h.schema_drift).length,
        degraded: [...latestHealth.values()].filter((h) => h.status !== "ok").length,
        rows: [...latestHealth.values()],
      },
      failures,
      recent_runs: {
        data_source: (dsRuns.data ?? []).slice(0, 20),
        erp_connector: (erpRuns.data ?? []).slice(0, 20),
        parser: (parseRuns.data ?? []).slice(0, 20),
        data_prep: (prepRuns.data ?? []).slice(0, 20),
      },
    };
  });
