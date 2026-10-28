/**
 * APM + SIEM pipeline metrics, alert config, and incident functions.
 * Platform-admin gated.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { emitSiemEvent } from "@/lib/observability.server";

async function assertPlatformAdmin(ctx: { supabase: any; userId: string }) {
  const { data } = await ctx.supabase.rpc("has_platform_role", {
    _user_id: ctx.userId, _role: "platform_admin",
  });
  if (!data) throw new Error("Forbidden: platform_admin required.");
}

export type PipelineBucket = {
  sink: "apm" | "siem";
  bucket_ts: string;
  ok_count: number;
  drop_count: number;
  error_count: number;
  latency_avg_ms: number;
  latency_max_ms: number;
};

export type PipelineSummary = {
  sink: "apm" | "siem";
  total: number;
  ok: number;
  drops: number;
  errors: number;
  drop_rate_pct: number;
  error_rate_pct: number;
  latency_avg_ms: number;
  latency_max_ms: number;
  events_per_min: number;
};

function summarize(rows: PipelineBucket[], windowMinutes: number, sink: "apm" | "siem"): PipelineSummary {
  const mine = rows.filter((r) => r.sink === sink);
  const ok = mine.reduce((a, r) => a + Number(r.ok_count), 0);
  const drops = mine.reduce((a, r) => a + Number(r.drop_count), 0);
  const errors = mine.reduce((a, r) => a + Number(r.error_count), 0);
  const total = ok + drops + errors;
  const latSum = mine.reduce((a, r) => a + Number(r.latency_avg_ms) * (Number(r.ok_count) + Number(r.error_count)), 0);
  const latN = ok + errors;
  const latMax = mine.reduce((a, r) => Math.max(a, Number(r.latency_max_ms)), 0);
  return {
    sink,
    total, ok, drops, errors,
    drop_rate_pct: total ? (drops / total) * 100 : 0,
    error_rate_pct: (ok + errors) ? (errors / (ok + errors)) * 100 : 0,
    latency_avg_ms: latN ? latSum / latN : 0,
    latency_max_ms: latMax,
    events_per_min: total / Math.max(1, windowMinutes),
  };
}

export const getPipelineMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { window_minutes?: number } | undefined) =>
    z.object({ window_minutes: z.number().int().min(1).max(1440).default(60) }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { data: rows, error } = await context.supabase.rpc("pipeline_stats_window", {
      _minutes: data.window_minutes,
    });
    if (error) throw new Error(error.message);
    const buckets = (rows ?? []) as PipelineBucket[];
    return {
      window_minutes: data.window_minutes,
      buckets,
      apm: summarize(buckets, data.window_minutes, "apm"),
      siem: summarize(buckets, data.window_minutes, "siem"),
    };
  });

export const listAlertConfigs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await context.supabase
      .from("observability_alert_config")
      .select("*").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const AlertUpsert = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2).max(120),
  sink: z.enum(["apm", "siem", "any"]),
  metric: z.enum(["drop_rate_pct", "p95_latency_ms", "event_volume_min", "error_rate_pct"]),
  threshold: z.number().finite(),
  window_minutes: z.number().int().min(1).max(1440),
  enabled: z.boolean(),
});

export const upsertAlertConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => AlertUpsert.parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const row = { ...data, created_by: context.userId, updated_at: new Date().toISOString() };
    const { data: saved, error } = await context.supabase
      .from("observability_alert_config").upsert(row).select().single();
    if (error) throw new Error(error.message);
    return saved;
  });

export const deleteAlertConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { error } = await context.supabase
      .from("observability_alert_config").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listAlertIncidents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await context.supabase
      .from("observability_alert_incidents")
      .select("id, config_id, fired_at, observed_value, message, resolved_at, observability_alert_config(name, metric, sink, threshold)")
      .order("fired_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const resolveAlertIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { error } = await context.supabase
      .from("observability_alert_incidents")
      .update({ resolved_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Evaluate every enabled alert against its window; insert incidents when breached and emit a SIEM event. */
export const evaluatePipelineAlerts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data: configs, error: cErr } = await context.supabase
      .from("observability_alert_config").select("*").eq("enabled", true);
    if (cErr) throw new Error(cErr.message);

    const fired: Array<{ config_id: string; message: string; value: number }> = [];

    for (const cfg of configs ?? []) {
      const { data: rows, error } = await context.supabase.rpc("pipeline_stats_window", {
        _minutes: cfg.window_minutes,
      });
      if (error) continue;
      const buckets = (rows ?? []) as PipelineBucket[];
      const sinks: Array<"apm" | "siem"> = cfg.sink === "any" ? ["apm", "siem"] : [cfg.sink as "apm" | "siem"];
      for (const sink of sinks) {
        const s = summarize(buckets, cfg.window_minutes, sink);
        let value = 0;
        let breach = false;
        switch (cfg.metric) {
          case "drop_rate_pct":     value = s.drop_rate_pct;   breach = value > Number(cfg.threshold); break;
          case "error_rate_pct":    value = s.error_rate_pct;  breach = value > Number(cfg.threshold); break;
          case "p95_latency_ms":    value = s.latency_max_ms;  breach = value > Number(cfg.threshold); break;
          case "event_volume_min":  value = s.events_per_min;  breach = value < Number(cfg.threshold); break;
        }
        if (breach) {
          const message = `[${sink.toUpperCase()}] ${cfg.metric} = ${value.toFixed(2)} breached threshold ${cfg.threshold} over ${cfg.window_minutes}m`;
          const { data: inc } = await context.supabase
            .from("observability_alert_incidents")
            .insert({ config_id: cfg.id, observed_value: value, message })
            .select().single();
          await context.supabase.from("observability_alert_config")
            .update({ last_fired_at: new Date().toISOString() }).eq("id", cfg.id);
          fired.push({ config_id: cfg.id, message, value });
          void emitSiemEvent({
            event_type: "observability.pipeline.alert",
            severity: cfg.metric === "drop_rate_pct" || cfg.metric === "error_rate_pct" ? "high" : "medium",
            outcome: "failure",
            action: "alert.fired",
            resource: `pipeline/${sink}`,
            attributes: { config_id: cfg.id, incident_id: inc?.id, metric: cfg.metric, value, threshold: cfg.threshold },
          });
        }
      }
    }
    return { evaluated: (configs ?? []).length, fired: fired.length, incidents: fired };
  });
