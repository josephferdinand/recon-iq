import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============================================================================
// Enterprise AI Analytics — Usage, Tokens, Cost, Risk, Ops, Status
// All aggregates computed dynamically from ai_usage_events + governance tables.
// No hardcoded provider/model/pricing values.
// ============================================================================

export type Granularity = "hour" | "day" | "week" | "month" | "quarter" | "year";
export type AnalyticsInput = {
  from?: string;                 // ISO
  to?: string;                   // ISO
  granularity?: Granularity;
  tenant_id?: string | null;     // when set, scope to a tenant
  workspace_id?: string | null;  // scoped via meta->>workspace_id
  user_id?: string | null;
  provider?: string | null;      // provider code (from model prefix or meta.provider)
  model?: string | null;
  scope?: string | null;         // copilot|agent|aidp|schema_map|tool|other
  top_n?: number;
};

type UsageRow = {
  tenant_id: string;
  user_id: string | null;
  model: string;
  scope: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  created_at: string;
  meta: Record<string, any>;
};

function parseRange(input: AnalyticsInput): { from: string; to: string; gran: Granularity } {
  const to = input.to ?? new Date().toISOString();
  const from = input.from ?? new Date(Date.now() - 30 * 86400_000).toISOString();
  const gran: Granularity = input.granularity ?? "day";
  return { from, to, gran };
}

function bucketKey(iso: string, gran: Granularity): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  switch (gran) {
    case "hour": return `${y}-${m}-${day}T${h}:00`;
    case "day": return `${y}-${m}-${day}`;
    case "week": {
      const first = new Date(Date.UTC(y, 0, 1));
      const week = Math.ceil(((d.getTime() - first.getTime()) / 86400000 + first.getUTCDay() + 1) / 7);
      return `${y}-W${pad(week)}`;
    }
    case "month": return `${y}-${m}`;
    case "quarter": return `${y}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    case "year": return `${y}`;
  }
}

function providerOf(row: UsageRow): string {
  const metaProv = (row.meta && (row.meta.provider || row.meta.provider_code)) as string | undefined;
  if (metaProv) return String(metaProv);
  const key = (row.model || "unknown").split(/[/:]/)[0];
  return key || "unknown";
}

async function loadUsage(context: any, input: AnalyticsInput): Promise<{ rows: UsageRow[]; from: string; to: string; gran: Granularity }> {
  const { from, to, gran } = parseRange(input);
  let q = context.supabase
    .from("ai_usage_events")
    .select("tenant_id,user_id,model,scope,tokens_in,tokens_out,cost_usd,created_at,meta")
    .gte("created_at", from)
    .lte("created_at", to)
    .order("created_at", { ascending: true })
    .limit(20000);
  if (input.tenant_id) q = q.eq("tenant_id", input.tenant_id);
  if (input.user_id) q = q.eq("user_id", input.user_id);
  if (input.scope) q = q.eq("scope", input.scope);
  if (input.model) q = q.eq("model", input.model);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  let rows = (data ?? []) as UsageRow[];
  if (input.provider) rows = rows.filter((r) => providerOf(r) === input.provider);
  if (input.workspace_id) rows = rows.filter((r) => r.meta?.workspace_id === input.workspace_id);
  return { rows, from, to, gran };
}

function topN<T>(map: Record<string, T>, n: number, key: (v: T) => number): Array<{ label: string; value: number }> {
  return Object.entries(map)
    .map(([label, v]) => ({ label, value: Number(key(v).toFixed(2)) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

// ---------- USAGE ANALYTICS ----------
export const getUsageAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => (d ?? {}) as AnalyticsInput)
  .handler(async ({ data, context }) => {
    const { rows, from, to, gran } = await loadUsage(context, data);
    const n = data.top_n ?? 10;

    // Time series buckets
    const buckets: Record<string, { requests: number; prompt_tokens: number; completion_tokens: number; cost: number }> = {};
    // Dimensional breakdowns
    const byTenant: Record<string, number> = {};
    const byUser: Record<string, number> = {};
    const byModel: Record<string, number> = {};
    const byProvider: Record<string, number> = {};
    const byWorkspace: Record<string, number> = {};
    const byScope: Record<string, number> = {};

    for (const r of rows) {
      const k = bucketKey(r.created_at, gran);
      const b = buckets[k] ?? { requests: 0, prompt_tokens: 0, completion_tokens: 0, cost: 0 };
      b.requests += 1;
      b.prompt_tokens += r.tokens_in;
      b.completion_tokens += r.tokens_out;
      b.cost += Number(r.cost_usd);
      buckets[k] = b;

      byTenant[r.tenant_id] = (byTenant[r.tenant_id] ?? 0) + 1;
      if (r.user_id) byUser[r.user_id] = (byUser[r.user_id] ?? 0) + 1;
      byModel[r.model] = (byModel[r.model] ?? 0) + 1;
      byProvider[providerOf(r)] = (byProvider[providerOf(r)] ?? 0) + 1;
      byScope[r.scope] = (byScope[r.scope] ?? 0) + 1;
      const ws = r.meta?.workspace_id;
      if (ws) byWorkspace[String(ws)] = (byWorkspace[String(ws)] ?? 0) + 1;
    }

    const series = Object.entries(buckets)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([bucket, v]) => ({
        bucket,
        requests: v.requests,
        prompt_tokens: v.prompt_tokens,
        completion_tokens: v.completion_tokens,
        cost_usd: Number(v.cost.toFixed(4)),
      }));

    return {
      range: { from, to, granularity: gran },
      totals: {
        requests: rows.length,
        prompt_tokens: rows.reduce((a, r) => a + r.tokens_in, 0),
        completion_tokens: rows.reduce((a, r) => a + r.tokens_out, 0),
        cost_usd: Number(rows.reduce((a, r) => a + Number(r.cost_usd), 0).toFixed(4)),
        agent_executions: rows.filter((r) => r.scope === "agent").length,
        copilot_interactions: rows.filter((r) => r.scope === "copilot").length,
      },
      series,
      breakdowns: {
        by_tenant: topN(byTenant, n, (v) => Number(v)),
        by_user: topN(byUser, n, (v) => Number(v)),
        by_model: topN(byModel, n, (v) => Number(v)),
        by_provider: topN(byProvider, n, (v) => Number(v)),
        by_workspace: topN(byWorkspace, n, (v) => Number(v)),
        by_scope: topN(byScope, n, (v) => Number(v)),
      },
    };
  });

// ---------- TOKEN ANALYTICS ----------
export const getTokenAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => (d ?? {}) as AnalyticsInput)
  .handler(async ({ data, context }) => {
    const { rows, from, to, gran } = await loadUsage(context, data);
    const n = data.top_n ?? 10;

    const buckets: Record<string, { input: number; output: number; cached: number; embedding: number; agent: number; rag: number; tool: number }> = {};
    const byModelTokens: Record<string, number> = {};
    const byProviderTokens: Record<string, number> = {};
    const byTenantTokens: Record<string, number> = {};
    const byUserTokens: Record<string, number> = {};
    const byWorkspaceTokens: Record<string, number> = {};

    let cached = 0, embedding = 0, agentTok = 0, ragTok = 0, toolTok = 0;

    for (const r of rows) {
      const k = bucketKey(r.created_at, gran);
      const b = buckets[k] ?? { input: 0, output: 0, cached: 0, embedding: 0, agent: 0, rag: 0, tool: 0 };
      b.input += r.tokens_in;
      b.output += r.tokens_out;
      const m = r.meta ?? {};
      const cachedT = Number(m.cached_tokens ?? 0);
      const embT = r.scope === "schema_map" ? r.tokens_in : Number(m.embedding_tokens ?? 0);
      const agentT = r.scope === "agent" ? r.tokens_in + r.tokens_out : 0;
      const ragT = Number(m.rag_tokens ?? 0);
      const toolT = r.scope === "tool" ? r.tokens_in + r.tokens_out : 0;
      b.cached += cachedT; b.embedding += embT; b.agent += agentT; b.rag += ragT; b.tool += toolT;
      buckets[k] = b;
      cached += cachedT; embedding += embT; agentTok += agentT; ragTok += ragT; toolTok += toolT;

      const total = r.tokens_in + r.tokens_out;
      byModelTokens[r.model] = (byModelTokens[r.model] ?? 0) + total;
      byProviderTokens[providerOf(r)] = (byProviderTokens[providerOf(r)] ?? 0) + total;
      byTenantTokens[r.tenant_id] = (byTenantTokens[r.tenant_id] ?? 0) + total;
      if (r.user_id) byUserTokens[r.user_id] = (byUserTokens[r.user_id] ?? 0) + total;
      const ws = r.meta?.workspace_id;
      if (ws) byWorkspaceTokens[String(ws)] = (byWorkspaceTokens[String(ws)] ?? 0) + total;
    }

    const series = Object.entries(buckets)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([bucket, v]) => ({ bucket, ...v, total: v.input + v.output }));

    const totalIn = rows.reduce((a, r) => a + r.tokens_in, 0);
    const totalOut = rows.reduce((a, r) => a + r.tokens_out, 0);

    // Naive linear forecast: average of last 7 buckets projected out equal periods
    const tail = series.slice(-7);
    const avg = tail.length ? tail.reduce((a, s) => a + s.input + s.output, 0) / tail.length : 0;
    const forecast_next_7 = Array.from({ length: 7 }).map((_, i) => ({ bucket: `+${i + 1}${gran[0]}`, projected: Math.round(avg) }));

    return {
      range: { from, to, granularity: gran },
      totals: {
        input: totalIn,
        output: totalOut,
        total: totalIn + totalOut,
        cached, embedding, agent: agentTok, rag: ragTok, tool: toolTok,
        prompt: totalIn,
        completion: totalOut,
      },
      series,
      forecast: forecast_next_7,
      breakdowns: {
        by_model: topN(byModelTokens, n, (v) => Number(v)),
        by_provider: topN(byProviderTokens, n, (v) => Number(v)),
        by_tenant: topN(byTenantTokens, n, (v) => Number(v)),
        by_user: topN(byUserTokens, n, (v) => Number(v)),
        by_workspace: topN(byWorkspaceTokens, n, (v) => Number(v)),
      },
    };
  });

// ---------- COST ANALYTICS ----------
export const getCostAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => (d ?? {}) as AnalyticsInput)
  .handler(async ({ data, context }) => {
    const { rows, from, to, gran } = await loadUsage(context, data);
    const n = data.top_n ?? 10;

    // Load pricing card + budgets
    const [{ data: pricing }, { data: budgets }] = await Promise.all([
      context.supabase
        .from("ai_model_pricing")
        .select("provider_code,model_key,input_usd_per_1m,output_usd_per_1m")
        .eq("active", true),
      context.supabase.from("ai_budgets").select("*"),
    ]);
    const priceMap: Record<string, { in: number; out: number }> = {};
    for (const p of pricing ?? []) {
      const per1k = {
        in: Number(p.input_usd_per_1m ?? 0) / 1000,
        out: Number(p.output_usd_per_1m ?? 0) / 1000,
      };
      priceMap[`${p.provider_code}/${p.model_key}`] = per1k;
      priceMap[p.model_key] ??= per1k;
    }

    const buckets: Record<string, number> = {};
    const byProvider: Record<string, number> = {};
    const byModel: Record<string, number> = {};
    const byTenant: Record<string, number> = {};
    const byUser: Record<string, number> = {};
    const byWorkspace: Record<string, number> = {};
    const byDept: Record<string, number> = {};
    const byAgent: Record<string, number> = {};

    for (const r of rows) {
      const c = Number(r.cost_usd);
      const k = bucketKey(r.created_at, gran);
      buckets[k] = (buckets[k] ?? 0) + c;
      byProvider[providerOf(r)] = (byProvider[providerOf(r)] ?? 0) + c;
      byModel[r.model] = (byModel[r.model] ?? 0) + c;
      byTenant[r.tenant_id] = (byTenant[r.tenant_id] ?? 0) + c;
      if (r.user_id) byUser[r.user_id] = (byUser[r.user_id] ?? 0) + c;
      const ws = r.meta?.workspace_id; if (ws) byWorkspace[String(ws)] = (byWorkspace[String(ws)] ?? 0) + c;
      const dept = r.meta?.department; if (dept) byDept[String(dept)] = (byDept[String(dept)] ?? 0) + c;
      const agent = r.meta?.agent_id ?? (r.scope === "agent" ? "agent:default" : null);
      if (agent) byAgent[String(agent)] = (byAgent[String(agent)] ?? 0) + c;
    }

    const series = Object.entries(buckets)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([bucket, cost]) => ({ bucket, cost_usd: Number(cost.toFixed(4)) }));

    // Anomaly detection: bucket cost > mean + 2*stddev
    const values = series.map((s) => s.cost_usd);
    const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const variance = values.length ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length : 0;
    const std = Math.sqrt(variance);
    const anomalies = series.filter((s) => std > 0 && s.cost_usd > mean + 2 * std);

    // Forecast: extrapolate linear trend
    const tail = series.slice(-7);
    const avg = tail.length ? tail.reduce((a, s) => a + s.cost_usd, 0) / tail.length : 0;
    const growth = tail.length >= 2 ? (tail[tail.length - 1].cost_usd - tail[0].cost_usd) / tail.length : 0;
    const forecast = Array.from({ length: 7 }).map((_, i) => ({ bucket: `+${i + 1}${gran[0]}`, projected: Number((avg + growth * (i + 1)).toFixed(4)) }));

    // Budget vs actual
    const totalCost = rows.reduce((a, r) => a + Number(r.cost_usd), 0);
    const totalBudget = (budgets ?? []).reduce((a: number, b: any) => a + Number(b.limit_usd ?? b.monthly_limit_usd ?? 0), 0);

    // Provider/model cost intelligence — dynamic per-1K rates from pricing table
    const providerModelCostCard: Array<{ model: string; input_per_1k: number; output_per_1k: number }> = Object.entries(priceMap).map(([model, v]) => ({ model, input_per_1k: v.in, output_per_1k: v.out }));

    return {
      range: { from, to, granularity: gran },
      totals: {
        cost_usd: Number(totalCost.toFixed(4)),
        budget_usd: Number(totalBudget.toFixed(2)),
        budget_utilization_pct: totalBudget > 0 ? Number(((totalCost / totalBudget) * 100).toFixed(2)) : null,
      },
      series,
      forecast,
      anomalies,
      breakdowns: {
        by_provider: topN(byProvider, n, (v) => Number(v)),
        by_model: topN(byModel, n, (v) => Number(v)),
        by_tenant: topN(byTenant, n, (v) => Number(v)),
        by_user: topN(byUser, n, (v) => Number(v)),
        by_workspace: topN(byWorkspace, n, (v) => Number(v)),
        by_department: topN(byDept, n, (v) => Number(v)),
        by_agent: topN(byAgent, n, (v) => Number(v)),
      },
      pricing_card: providerModelCostCard,
    };
  });

// ---------- STATUS MATRIX ----------
export const getAiStatusMatrix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => (d ?? {}) as { tenant_id?: string | null })
  .handler(async ({ data, context }) => {
    const scope = data.tenant_id ? "tenant" : "platform";
    let q = context.supabase.from("ai_governance_toggles").select("key,value").eq("scope", scope);
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id); else q = q.is("tenant_id", null);
    const { data: toggles, error } = await q;
    if (error) throw new Error(error.message);
    const map: Record<string, any> = {};
    for (const t of toggles ?? []) map[t.key] = t.value;
    const val = (k: string, def: boolean) => {
      const v = map[k];
      if (v === undefined || v === null) return def;
      if (typeof v === "boolean") return v;
      if (typeof v === "string") return v === "true" || v === "enabled" || v === "on";
      if (typeof v === "object" && "enabled" in v) return !!v.enabled;
      return def;
    };
    return {
      ai_enabled: val("ai_enabled", true),
      copilot_enabled: val("copilot_enabled", true),
      autonomous_agents: val("autonomous_agents_enabled", false),
      agentic_workflows: val("agentic_workflows_enabled", false),
      byo_llm: val("byo_llm_enabled", false),
      external_providers: val("external_providers_enabled", true),
      prompt_logging: val("prompt_logging_enabled", true),
      pii_protection: val("pii_protection_enabled", true),
      auto_remediation: val("auto_remediation_enabled", false),
      ai_recommendations: val("ai_recommendations_enabled", true),
      raw: map,
    };
  });

// ---------- RISK & COMPLIANCE ----------
export const getRiskCompliance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => (d ?? {}) as { tenant_id?: string | null; days?: number })
  .handler(async ({ data, context }) => {
    const days = data.days ?? 30;
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const tid = data.tenant_id ?? null;

    const scope = (q: any) => (tid ? q.eq("tenant_id", tid) : q);

    const [hitl, drift, kills, prompts] = await Promise.all([
      scope(context.supabase.from("ai_governance_hitl_queue").select("id,status,confidence,created_at").gte("created_at", since).limit(2000)),
      scope(context.supabase.from("ai_governance_drift_alerts").select("id,severity,status,delta_pct,created_at").gte("created_at", since).limit(2000)),
      scope(context.supabase.from("ai_governance_kill_switches").select("id,scope,engaged,reason,updated_at")),
      scope(context.supabase.from("ai_governance_prompt_log").select("id,outcome,hitl_required,confidence,created_at").gte("created_at", since).limit(5000)),
    ]);

    const blocked = (prompts.data ?? []).filter((p: any) => p.outcome === "blocked").length;
    const hitl_pending = (hitl.data ?? []).filter((h: any) => h.status === "pending").length;
    const drift_open = (drift.data ?? []).filter((d: any) => d.status === "open").length;
    const kill_engaged = (kills.data ?? []).filter((k: any) => k.engaged).length;
    const total = (prompts.data ?? []).length || 1;
    const avgConf = (prompts.data ?? []).reduce((a: number, p: any) => a + Number(p.confidence ?? 0), 0) / total;

    // Risk score: 0–100, higher = riskier
    const risk_score = Math.min(100, Math.round((blocked / total) * 40 + (drift_open / 10) * 20 + (kill_engaged) * 20 + (hitl_pending / 20) * 20));

    // Series of daily blocked prompts
    const daily: Record<string, number> = {};
    for (const p of prompts.data ?? []) {
      if (p.outcome === "blocked") {
        const k = bucketKey(p.created_at, "day");
        daily[k] = (daily[k] ?? 0) + 1;
      }
    }
    const blocked_series = Object.entries(daily).sort(([a], [b]) => (a < b ? -1 : 1)).map(([bucket, count]) => ({ bucket, count }));

    return {
      totals: {
        blocked_prompts: blocked,
        hitl_pending,
        drift_alerts_open: drift_open,
        kill_switches_engaged: kill_engaged,
        avg_confidence: Number(avgConf.toFixed(3)),
      },
      risk_score,
      blocked_series,
      kill_switches: kills.data ?? [],
      recent_drift: (drift.data ?? []).slice(0, 20),
      recent_hitl: (hitl.data ?? []).slice(0, 20),
    };
  });

// ---------- OPS DASHBOARD ----------
export const getAiOpsSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => (d ?? {}) as { tenant_id?: string | null; minutes?: number })
  .handler(async ({ data, context }) => {
    const minutes = data.minutes ?? 60;
    const since = new Date(Date.now() - minutes * 60_000).toISOString();
    const tid = data.tenant_id ?? null;
    const scope = (q: any) => (tid ? q.eq("tenant_id", tid) : q);

    const [instances, logs] = await Promise.all([
      context.supabase.from("ai_provider_instances").select("id,provider_code,display_name,status,health_status,last_healthcheck_at"),
      scope(context.supabase.from("ai_governance_prompt_log").select("model,latency_ms,outcome,created_at").gte("created_at", since).limit(5000)),
    ]);

    const perProvider: Record<string, { count: number; latency_sum: number; errors: number }> = {};
    for (const l of logs.data ?? []) {
      const key = String(l.model || "unknown").split(/[/:]/)[0] || "unknown";
      const b = perProvider[key] ?? { count: 0, latency_sum: 0, errors: 0 };
      b.count += 1;
      b.latency_sum += Number(l.latency_ms ?? 0);
      if (l.outcome === "error" || l.outcome === "blocked") b.errors += 1;
      perProvider[key] = b;
    }

    const provider_metrics = Object.entries(perProvider).map(([provider, v]) => ({
      provider,
      requests: v.count,
      avg_latency_ms: v.count ? Math.round(v.latency_sum / v.count) : 0,
      error_rate_pct: v.count ? Number(((v.errors / v.count) * 100).toFixed(2)) : 0,
      rpm: Number((v.count / minutes).toFixed(2)),
    })).sort((a, b) => b.requests - a.requests);

    const health = {
      total: (instances.data ?? []).length,
      healthy: (instances.data ?? []).filter((i: any) => i.health_status === "healthy").length,
      degraded: (instances.data ?? []).filter((i: any) => i.health_status === "degraded").length,
      down: (instances.data ?? []).filter((i: any) => i.health_status === "down").length,
      unknown: (instances.data ?? []).filter((i: any) => i.health_status === "unknown").length,
    };

    return {
      window_minutes: minutes,
      health,
      provider_metrics,
      instances: instances.data ?? [],
    };
  });
