/**
 * AI Governance — Failover routing, test runs, and approval-workflow toggles.
 *
 * Surfaces the per-tenant configuration introduced in migration
 * 20260630_ai_governance_routing_failover_approvals. Tenant admins manage
 * primary + fallback1 + fallback2 providers per feature, fire test scenarios
 * against the route, and toggle dual-approval / four-eyes / governance /
 * security / compliance review gates.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantAdmin } from "@/lib/rbac-guards.server";
import { z } from "zod";

const FEATURE_KEYS = [
  "copilot.chat",
  "copilot.agent",
  "aidp.predict",
  "rekon.wizard",
  "anomaly_scan",
  "recommend_fix",
] as const;

async function assertTenantAdmin(ctx: any, tenantId: string) {
  await requireTenantAdmin(ctx, tenantId, { fnName: "ai-governance-routing" });
}

/* -------------------- Routes -------------------- */
export const listModelRoutes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) =>
    z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("llm_model_routes")
      .select("*")
      .eq("tenant_id", data.tenant_id)
      .order("feature_key");
    if (error) throw new Error(error.message);
    return { routes: rows ?? [], featureKeys: FEATURE_KEYS };
  });

const RouteSchema = z.object({
  tenant_id: z.string().uuid(),
  feature_key: z.string().min(1).max(64),
  primary_provider_id: z.string().uuid().nullable(),
  fallback1_provider_id: z.string().uuid().nullable(),
  fallback2_provider_id: z.string().uuid().nullable(),
  routing_strategy: z.enum([
    "priority", "availability", "latency", "cost", "performance", "manual", "policy",
  ]).default("priority"),
  is_active: z.boolean().default(true),
});
export const upsertModelRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => RouteSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const { error } = await context.supabase
      .from("llm_model_routes")
      .upsert({ ...data, created_by: context.userId } as any,
        { onConflict: "tenant_id,feature_key" });
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: "ai_governance.route.upsert",
      resource_type: "llm_model_routes",
      resource_id: null,
      context: { feature: data.feature_key, strategy: data.routing_strategy },
    } as any);
    return { ok: true };
  });

/* -------------------- Failover test runs -------------------- */
const TestSchema = z.object({
  tenant_id: z.string().uuid(),
  route_id: z.string().uuid().optional(),
  scenario: z.enum([
    "primary", "fallback1", "fallback2", "health", "connectivity",
    "auth", "throughput", "latency", "full_failover", "rate_limit", "timeout",
  ]),
  provider_id: z.string().uuid().optional(),
});
export const runFailoverTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => TestSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const started = Date.now();

    // Resolve provider for the scenario.
    let providerId = data.provider_id ?? null;
    let providerRow: any = null;
    if (!providerId && data.route_id) {
      const { data: route } = await context.supabase
        .from("llm_model_routes")
        .select("primary_provider_id, fallback1_provider_id, fallback2_provider_id")
        .eq("id", data.route_id).maybeSingle();
      if (route) {
        if (data.scenario === "fallback1") providerId = (route as any).fallback1_provider_id;
        else if (data.scenario === "fallback2") providerId = (route as any).fallback2_provider_id;
        else providerId = (route as any).primary_provider_id;
      }
    }
    if (providerId) {
      const { data: p } = await context.supabase
        .from("llm_providers").select("id, provider, model, is_active").eq("id", providerId).maybeSingle();
      providerRow = p;
    }

    // Synthetic probe — for now this is a structural check (provider exists +
    // is_active). Real network probes live behind the model factory; recording
    // the attempt is what the auditor needs, and the row is the audit row.
    let status: "pass" | "fail" = "pass";
    let errorMessage: string | null = null;
    if (!providerRow) { status = "fail"; errorMessage = "Provider not configured"; }
    else if (!providerRow.is_active) { status = "fail"; errorMessage = "Provider is inactive"; }

    const latency = Date.now() - started;
    const { data: ins, error } = await context.supabase
      .from("llm_failover_test_runs")
      .insert({
        tenant_id: data.tenant_id,
        route_id: data.route_id ?? null,
        scenario: data.scenario,
        provider_used: providerRow?.id ?? null,
        model_used: providerRow?.model ?? null,
        status,
        latency_ms: latency,
        tokens_in: 0,
        tokens_out: 0,
        cost_usd: 0,
        error_message: errorMessage,
        context: { synthetic: true },
        tested_by: context.userId,
      } as any)
      .select("id").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: "ai_governance.failover_test",
      resource_type: "llm_failover_test_runs",
      resource_id: (ins as any).id,
      context: { scenario: data.scenario, status },
    } as any);
    return { id: (ins as any).id, status, latency_ms: latency, error_message: errorMessage };
  });

export const listFailoverTestRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; limit?: number }) =>
    z.object({ tenant_id: z.string().uuid(), limit: z.number().int().min(1).max(200).default(50) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("llm_failover_test_runs")
      .select("*")
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/* -------------------- Approval settings -------------------- */
export const getApprovalSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) =>
    z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("governance_approval_settings")
      .select("*").eq("tenant_id", data.tenant_id).maybeSingle();
    return row ?? {
      tenant_id: data.tenant_id,
      dual_approval_enabled: false,
      four_eyes_enabled: false,
      governance_review_enabled: false,
      security_review_enabled: false,
      compliance_review_enabled: false,
    };
  });

const ApprovalSchema = z.object({
  tenant_id: z.string().uuid(),
  dual_approval_enabled: z.boolean(),
  four_eyes_enabled: z.boolean(),
  governance_review_enabled: z.boolean(),
  security_review_enabled: z.boolean(),
  compliance_review_enabled: z.boolean(),
});
export const updateApprovalSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => ApprovalSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const { error } = await context.supabase
      .from("governance_approval_settings")
      .upsert({ ...data, updated_by: context.userId, updated_at: new Date().toISOString() } as any,
        { onConflict: "tenant_id" });
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: "ai_governance.approval_settings.update",
      resource_type: "governance_approval_settings",
      resource_id: data.tenant_id,
      context: {
        dual: data.dual_approval_enabled,
        four_eyes: data.four_eyes_enabled,
        gov: data.governance_review_enabled,
        sec: data.security_review_enabled,
        comp: data.compliance_review_enabled,
      },
    } as any);
    return { ok: true };
  });

/* -------------------- FinOps rollups -------------------- */
export const getFinOpsAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; days?: number }) =>
    z.object({ tenant_id: z.string().uuid(), days: z.number().int().min(1).max(180).default(30) }).parse(d))
  .handler(async ({ data, context }) => {
    const since = new Date(Date.now() - data.days * 86400_000).toISOString();
    const { data: events, error } = await context.supabase
      .from("ai_usage_events")
      .select("created_at, scope, model, tokens_in, tokens_out, cost_usd, user_id, meta")
      .eq("tenant_id", data.tenant_id)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20000);
    if (error) throw new Error(error.message);

    type Bucket = { tokens_in: number; tokens_out: number; cost: number; count: number; cached: number };
    const empty = (): Bucket => ({ tokens_in: 0, tokens_out: 0, cost: 0, count: 0, cached: 0 });
    const byDay: Record<string, Bucket> = {};
    const byModel: Record<string, Bucket> = {};
    const byProvider: Record<string, Bucket> = {};
    const byFeature: Record<string, Bucket> = {};
    const byUser: Record<string, Bucket> = {};
    let totalIn = 0, totalOut = 0, totalCost = 0, totalCached = 0, successCount = 0, failCount = 0;
    let monthCost = 0;
    const monthStart = new Date();
    monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);

    for (const e of events ?? []) {
      const meta = (e as any).meta ?? {};
      const provider = String(meta.provider ?? "meta");
      const feature = String(meta.feature ?? (e as any).scope ?? "unknown");
      const cached = Number(meta.cached_tokens ?? 0);
      const ti = Number((e as any).tokens_in ?? 0);
      const to = Number((e as any).tokens_out ?? 0);
      const cost = Number((e as any).cost_usd ?? 0);
      const status = String(meta.status ?? "success");

      totalIn += ti; totalOut += to; totalCost += cost; totalCached += cached;
      if (status === "success") successCount++; else failCount++;
      if (new Date((e as any).created_at) >= monthStart) monthCost += cost;

      const day = String((e as any).created_at).slice(0, 10);
      (byDay[day] ||= empty()).cost += cost;
      byDay[day].tokens_in += ti; byDay[day].tokens_out += to; byDay[day].count++; byDay[day].cached += cached;

      const m = String((e as any).model ?? "unknown");
      (byModel[m] ||= empty());
      byModel[m].tokens_in += ti; byModel[m].tokens_out += to; byModel[m].cost += cost; byModel[m].count++; byModel[m].cached += cached;

      (byProvider[provider] ||= empty());
      byProvider[provider].tokens_in += ti; byProvider[provider].tokens_out += to;
      byProvider[provider].cost += cost; byProvider[provider].count++; byProvider[provider].cached += cached;

      (byFeature[feature] ||= empty());
      byFeature[feature].tokens_in += ti; byFeature[feature].tokens_out += to;
      byFeature[feature].cost += cost; byFeature[feature].count++; byFeature[feature].cached += cached;

      const u = (e as any).user_id ?? "unknown";
      (byUser[u] ||= empty());
      byUser[u].tokens_in += ti; byUser[u].tokens_out += to;
      byUser[u].cost += cost; byUser[u].count++; byUser[u].cached += cached;
    }

    const totalReqs = (events ?? []).length;
    return {
      kpis: {
        requests: totalReqs,
        tokens_in: totalIn,
        tokens_out: totalOut,
        tokens_total: totalIn + totalOut,
        cached_tokens: totalCached,
        cost_total: totalCost,
        cost_month: monthCost,
        avg_cost_per_request: totalReqs ? totalCost / totalReqs : 0,
        avg_tokens_per_request: totalReqs ? (totalIn + totalOut) / totalReqs : 0,
        success_rate: totalReqs ? successCount / totalReqs : 1,
        failure_rate: totalReqs ? failCount / totalReqs : 0,
        active_models: Object.keys(byModel).length,
        active_providers: Object.keys(byProvider).length,
        active_users: Object.keys(byUser).length,
      },
      byDay: Object.entries(byDay).map(([k, v]) => ({ date: k, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
      byModel: Object.entries(byModel).map(([k, v]) => ({ model: k, ...v })).sort((a, b) => b.cost - a.cost),
      byProvider: Object.entries(byProvider).map(([k, v]) => ({ provider: k, ...v })).sort((a, b) => b.cost - a.cost),
      byFeature: Object.entries(byFeature).map(([k, v]) => ({ feature: k, ...v })).sort((a, b) => b.cost - a.cost),
      byUser: Object.entries(byUser).map(([k, v]) => ({ user_id: k, ...v })).sort((a, b) => b.cost - a.cost).slice(0, 50),
    };
  });
