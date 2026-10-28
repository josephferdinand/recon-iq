import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Filter = z.object({
  tenant_id: z.string().uuid().nullable().optional(),
  window_hours: z.number().int().min(1).max(720).default(72),
});

export const reconHealthOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => Filter.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const since = new Date(Date.now() - data.window_hours * 3600_000).toISOString();

    // Regulatory pack installs
    let installsQ = context.supabase
      .from("regulatory_pack_installs")
      .select("id, tenant_id, pack_id, installed_version, status, started_at, completed_at, error_message, materialization_error, generated_process_count, recon_id")
      .order("started_at", { ascending: false })
      .limit(200);
    if (data.tenant_id) installsQ = installsQ.eq("tenant_id", data.tenant_id);
    const { data: installs, error: iErr } = await installsQ;
    if (iErr) throw new Error(iErr.message);

    // Recon runs in window
    let runsQ = context.supabase
      .from("recon_runs")
      .select("id, tenant_id, definition_id, status, started_at, finished_at, error, run_uid")
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(500);
    if (data.tenant_id) runsQ = runsQ.eq("tenant_id", data.tenant_id);
    const { data: runs, error: rErr } = await runsQ;
    if (rErr) throw new Error(rErr.message);

    // Pipeline runs
    let pipeQ = context.supabase
      .from("data_prep_runs")
      .select("id, tenant_id, pipeline_id, status, started_at, finished_at, error")
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(500);
    if (data.tenant_id) pipeQ = pipeQ.eq("tenant_id", data.tenant_id);
    const { data: pipes, error: pErr } = await pipeQ;
    if (pErr) throw new Error(pErr.message);

    // Failure reasons rollup (top 10) across runs + pipelines
    const failures = [
      ...(runs ?? []).filter((r: any) => r.status === "failed" && r.error).map((r: any) => ({ source: "recon_run", error: r.error })),
      ...(pipes ?? []).filter((p: any) => p.status === "failed" && p.error).map((p: any) => ({ source: "pipeline", error: p.error })),
    ];
    const buckets = new Map<string, { count: number; sample: string; source: string }>();
    for (const f of failures) {
      const key = (f.error ?? "unknown").slice(0, 80);
      const cur = buckets.get(key) ?? { count: 0, sample: f.error ?? "", source: f.source };
      cur.count += 1;
      buckets.set(key, cur);
    }
    const topFailures = Array.from(buckets.entries())
      .map(([key, v]) => ({ reason: key, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Totals
    const total = (runs ?? []).length;
    const ok = (runs ?? []).filter((r: any) => r.status === "completed" || r.status === "succeeded").length;
    const failed = (runs ?? []).filter((r: any) => r.status === "failed").length;
    const running = (runs ?? []).filter((r: any) => r.status === "running" || r.status === "started").length;

    return {
      window_hours: data.window_hours,
      totals: { runs: total, succeeded: ok, failed, running },
      installs: installs ?? [],
      recent_runs: (runs ?? []).slice(0, 50),
      recent_pipelines: (pipes ?? []).slice(0, 50),
      top_failures: topFailures,
    };
  });

const TraceArg = z.object({
  tenant_id: z.string().uuid(),
  resource_type: z.string().max(80),
  resource_id: z.string().max(200),
  limit: z.number().int().min(1).max(200).default(50),
});

export const auditTraceFor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => TraceArg.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("audit_log")
      .select("id, occurred_at, actor_email, scope, action, resource_type, resource_id, context")
      .eq("tenant_id", data.tenant_id)
      .eq("resource_type", data.resource_type)
      .eq("resource_id", data.resource_id)
      .order("occurred_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
