/**
 * ReconIQ Copilot tool catalogue — server-only.
 *
 * Tools execute against the **caller's** Supabase client, so every read is
 * automatically constrained by Row Level Security. Platform admins see
 * everything, tenant admins see their tenant, regular members see only their
 * memberships and assigned work. No raw SQL is exposed to the model.
 *
 * The tools accept JSON arguments matched by Zod schemas and return small,
 * model-friendly payloads (strings/objects with primitive fields).
 */
import { z } from "zod";
import { tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CopilotContext = {
  supabase: SupabaseClient;
  userId: string;
  scope: "platform" | "tenant" | "workspace";
  tenantId: string | null;
  isPlatformAdmin: boolean;
};

const sinceSchema = z
  .enum(["24h", "7d", "30d", "90d", "all"])
  .default("7d")
  .describe('Time window preset. Use "all" for no lower bound, or pass `days` for a custom window.');

const daysSchema = z
  .number()
  .int()
  .min(1)
  .max(3650)
  .optional()
  .describe("Custom day window (overrides `since`). Example: 14 for last 14 days.");

function sinceISO(window: z.infer<typeof sinceSchema>, days?: number): string | null {
  if (typeof days === "number" && days > 0) {
    return new Date(Date.now() - days * 86400e3).toISOString();
  }
  if (window === "all") return null;
  const ms =
    window === "24h" ? 24 * 3600e3 :
    window === "7d"  ? 7  * 86400e3 :
    window === "30d" ? 30 * 86400e3 :
                       90 * 86400e3;
  return new Date(Date.now() - ms).toISOString();
}


function withTenant<T extends { eq: any; is: any }>(q: T, ctx: CopilotContext): T {
  // Platform admins on a platform-scope thread get the global view.
  if (ctx.isPlatformAdmin && ctx.scope === "platform") return q;
  if (ctx.tenantId) return (q as any).eq("tenant_id", ctx.tenantId);
  return (q as any).is("tenant_id", null);
}

/** Build the tool set available to the model for this request. */
export function buildCopilotTools(ctx: CopilotContext) {
  const supa = ctx.supabase;

  return {
    /* ─────────────────  RECONCILIATIONS  ───────────────── */

    count_reconciliations: tool({
      description:
        "Count reconciliation definitions visible to the user. Filter by creation window and status.",
      inputSchema: z.object({
        since: sinceSchema,
        days: daysSchema,
        status: z.enum(["draft", "active", "paused", "archived", "any"]).default("any"),
      }),
      execute: async ({ since, days, status }) => {
        let q = supa.from("recon_definitions").select("id", { count: "exact", head: true });
        q = withTenant(q, ctx);
        const iso = sinceISO(since, days);
        if (iso) q = q.gte("created_at", iso);
        if (status !== "any") q = q.eq("status", status);
        const { count, error } = await q;
        if (error) return { error: error.message };
        return { count: count ?? 0, window: days ? `${days}d` : since, status };
      },
    }),

    list_recent_reconciliations: tool({
      description: "List the most recent reconciliation definitions the user can see.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(25).default(10),
        since: sinceSchema,
        days: daysSchema,
      }),
      execute: async ({ limit, since, days }) => {
        let q = supa
          .from("recon_definitions")
          .select("id,name,recon_type,status,created_at")
          .order("created_at", { ascending: false })
          .limit(limit);
        q = withTenant(q, ctx);
        const iso = sinceISO(since, days);
        if (iso) q = q.gte("created_at", iso);

        const { data, error } = await q;
        if (error) return { error: error.message };
        return { items: data ?? [] };
      },
    }),

    get_reconciliation: tool({
      description:
        "Look up a reconciliation by UUID, exact id-prefix, or case-insensitive partial name match. Use this when the user references 'REC-...', a name fragment, or a specific id.",
      inputSchema: z.object({
        query: z.string().min(1).max(120)
          .describe("UUID, id prefix, or partial name of the reconciliation."),
      }),
      execute: async ({ query }) => {
        const raw = query.trim();
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw);
        const cleaned = raw.replace(/[%_]/g, "");
        let q = supa
          .from("recon_definitions")
          .select("id,name,description,recon_type,status,created_at,updated_at")
          .limit(5);
        q = withTenant(q, ctx);
        if (isUuid) {
          q = q.eq("id", raw);
        } else {
          // Match against name OR id-prefix (covers user-facing short ids).
          q = q.or(`name.ilike.%${cleaned}%,id::text.ilike.${cleaned}%`);
        }
        const { data, error } = await q;
        if (error) return { error: error.message };
        return { matches: data ?? [] };
      },
    }),

    get_break: tool({
      description:
        "Look up a single break/exception by UUID, public case ID (e.g. FVI-EXC-…), id-prefix, or a business reference contained in the break reason (e.g. DEMO-002). Returns reason, status, severity, assignee and parent run/definition.",
      inputSchema: z.object({
        id: z.string().min(4).max(80).describe("UUID, public case ID, id prefix, or business reference of the break."),
      }),
      execute: async ({ id }) => {
        const raw = id.trim();
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw);
        const cleaned = raw.replace(/[%_\\]/g, "");
        const select =
          "id,public_case_id,reason,severity,status,priority,assignee,due_date,created_at,run_id,run:recon_runs(id,run_uid,started_at,definition:recon_definitions(id,name))";
        const attempts: Array<() => any> = [];
        if (isUuid) {
          attempts.push(() => withTenant(supa.from("recon_exceptions").select(select).limit(5), ctx).eq("id", raw));
        } else {
          if (/^FVI-EXC-[A-F0-9]{32}$/i.test(cleaned)) {
            attempts.push(() =>
              withTenant(supa.from("recon_exceptions").select(select).limit(5), ctx).eq("public_case_id", cleaned.toUpperCase()),
            );
          }
          attempts.push(() =>
            withTenant(supa.from("recon_exceptions").select(select).limit(5), ctx).ilike("reason", `%${cleaned}%`),
          );
          attempts.push(() =>
            withTenant(supa.from("recon_exceptions").select(select).limit(5), ctx).ilike("public_case_id", cleaned),
          );
        }
        let firstError: string | null = null;
        for (const attempt of attempts) {
          const { data, error } = await attempt();
          if (error) {
            if (!firstError) firstError = error.message;
            continue;
          }
          if (data && data.length > 0) return { found: true, matches: data };
        }
        if (firstError) return { error: firstError };
        return { found: false };
      },
    }),


    /* ─────────────────  RUNS  ───────────────── */

    count_runs: tool({
      description: "Count reconciliation runs (executions) within a window, optionally by status.",
      inputSchema: z.object({
        since: sinceSchema,
        days: daysSchema,
        status: z.enum(["queued","running","succeeded","failed","cancelled","any"]).default("any"),
      }),
      execute: async ({ since, days, status }) => {
        let q = supa.from("recon_runs").select("id", { count: "exact", head: true });
        q = withTenant(q, ctx);
        const iso = sinceISO(since, days);
        if (iso) q = q.gte("started_at", iso);
        if (status !== "any") q = q.eq("status", status);
        const { count, error } = await q;
        if (error) return { error: error.message };
        return { count: count ?? 0, window: days ? `${days}d` : since, status };
      },
    }),

    runs_summary: tool({
      description:
        "Aggregate run metrics for a window: total runs, matched volume, exception volume, success rate.",
      inputSchema: z.object({ since: sinceSchema, days: daysSchema }),
      execute: async ({ since, days }) => {
        let q = supa
          .from("recon_runs")
          .select("status,matched_count,exception_count,total_rows");
        q = withTenant(q, ctx);
        const iso = sinceISO(since, days);
        if (iso) q = q.gte("started_at", iso);
        const { data, error } = await q;
        if (error) return { error: error.message };
        const rows = (data ?? []) as any[];
        const matched   = rows.reduce((s, r) => s + (r.matched_count   ?? 0), 0);
        const exceptions= rows.reduce((s, r) => s + (r.exception_count ?? 0), 0);
        const total     = rows.reduce((s, r) => s + (r.total_rows      ?? 0), 0);
        const succ      = rows.filter((r) => r.status === "succeeded").length;
        return {
          window: days ? `${days}d` : since,
          total_runs: rows.length,
          succeeded: succ,
          failed: rows.filter((r) => r.status === "failed").length,
          success_rate: rows.length ? succ / rows.length : null,
          matched_rows: matched,
          exception_rows: exceptions,
          total_rows: total,
        };
      },
    }),

    /* ─────────────────  EXCEPTIONS / BREAKS  ───────────────── */

    count_breaks: tool({
      description:
        'Count reconciliation exceptions ("breaks"). Default returns OPEN breaks. Use status="any" for everything.',
      inputSchema: z.object({
        since: sinceSchema.default("30d"),
        days: daysSchema,
        status: z.enum(["open","investigating","pending_review","resolved","closed","any"]).default("open"),
        severity: z.enum(["low","medium","high","critical","any"]).default("any"),
      }),
      execute: async ({ since, days, status, severity }) => {
        let q = supa.from("recon_exceptions").select("id", { count: "exact", head: true });
        q = withTenant(q, ctx);
        const iso = sinceISO(since, days);
        if (iso) q = q.gte("created_at", iso);
        if (status !== "any") q = q.eq("status", status);
        if (severity !== "any") q = q.eq("severity", severity);
        const { count, error } = await q;
        if (error) return { error: error.message };
        return { count: count ?? 0, window: days ? `${days}d` : since, status, severity };
      },
    }),

    breaks_aging: tool({
      description:
        "Aging buckets for OPEN breaks: 0-1d, 2-7d, 8-30d, 30d+. Helps spot stale exceptions.",
      inputSchema: z.object({}),
      execute: async () => {
        let q = supa
          .from("recon_exceptions")
          .select("created_at,status")
          .in("status", ["open", "investigating", "pending_review"])
          .limit(10000);
        q = withTenant(q, ctx);
        const { data, error } = await q;
        if (error) return { error: error.message };
        const now = Date.now();
        const buckets = { "0-1d": 0, "2-7d": 0, "8-30d": 0, "30d+": 0 };
        for (const r of (data ?? []) as any[]) {
          const ageDays = (now - new Date(r.created_at).getTime()) / 86400e3;
          if (ageDays <= 1) buckets["0-1d"]++;
          else if (ageDays <= 7) buckets["2-7d"]++;
          else if (ageDays <= 30) buckets["8-30d"]++;
          else buckets["30d+"]++;
        }
        return { total_open: (data ?? []).length, buckets };
      },
    }),


    list_my_breaks: tool({
      description: "List the most recent breaks assigned to the current user.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(25).default(10),
        status: z.enum(["open","investigating","pending_review","resolved","closed","any"]).default("open"),
      }),
      execute: async ({ limit, status }) => {
        let q = supa
          .from("recon_exceptions")
          .select("id,reason,severity,status,priority,due_date,created_at,run_id")
          .eq("assignee", ctx.userId)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (status !== "any") q = q.eq("status", status);
        const { data, error } = await q;
        if (error) return { error: error.message };
        return { items: data ?? [] };
      },
    }),

    breaks_by_reason: tool({
      description:
        "Top break reasons in the window with their counts (helps identify root causes).",
      inputSchema: z.object({
        since: sinceSchema.default("30d"),
        days: daysSchema,
        limit: z.number().int().min(1).max(20).default(10),
      }),
      execute: async ({ since, days, limit }) => {
        let q = supa.from("recon_exceptions").select("reason");
        q = withTenant(q, ctx);
        const iso = sinceISO(since, days);
        if (iso) q = q.gte("created_at", iso);
        const { data, error } = await q.limit(5000);
        if (error) return { error: error.message };
        const counts = new Map<string, number>();
        for (const r of (data ?? []) as any[]) {
          const k = (r.reason ?? "(unknown)").trim() || "(unknown)";
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        const top = Array.from(counts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([reason, count]) => ({ reason, count }));
        return { window: days ? `${days}d` : since, top_reasons: top };
      },
    }),


    /* ─────────────────  KNOWLEDGE BASE (HYBRID RAG)  ───────────────── */

    search_kb: tool({
      description:
        "Hybrid (semantic + lexical) search across the Knowledge Base. Results are fused via reciprocal-rank-fusion with a per-tenant freshness boost. Returns the most relevant passages with title, slug, and fused score. Use for 'how do I…' and policy questions, then cite the article titles in your answer.",
      inputSchema: z.object({
        query: z.string().min(2).max(500),
        k: z.number().int().min(1).max(8).default(5),
      }),
      execute: async ({ query, k }) => hybridSearchKb(ctx, { query, k }),
    }),

    /* ─────────────────  SLA / RISK / ANOMALY / PATTERNS  ───────────────── */

    sla_at_risk: tool({
      description:
        "Surfaces reconciliations and breaks approaching SLA breach. Returns count + worst offenders sorted by time-to-breach.",
      inputSchema: z.object({
        window: z.enum(["today", "24h", "7d"]).default("today"),
        limit: z.number().int().min(1).max(50).default(10),
      }),
      execute: async ({ window, limit }) =>
        slaAtRisk(supa, scopeOf(ctx), { window, limit }),
    }),

    anomaly_scan: tool({
      description:
        "Detects run-volume drops, latency spikes, and new failure modes in recent reconciliation runs vs the prior comparable period.",
      inputSchema: z.object({
        lookback_days: z.number().int().min(1).max(90).default(7),
      }),
      execute: async ({ lookback_days }) =>
        anomalyScan(supa, scopeOf(ctx), { lookback_days }),
    }),

    repeat_break_patterns: tool({
      description:
        "Surfaces recurring break patterns (root-cause clusters) that have triggered more than `min_count` times in the window — useful for proactive intervention.",
      inputSchema: z.object({
        window_days: z.number().int().min(1).max(90).default(7),
        min_count: z.number().int().min(2).max(1000).default(3),
      }),
      execute: async ({ window_days, min_count }) =>
        repeatBreakPatterns(supa, scopeOf(ctx), { window_days, min_count }),
    }),



    /* ─────────────────  WORKSPACE CONTEXT  ───────────────── */

    whoami: tool({
      description: "Return basic facts about the current user, scope and tenant context.",
      inputSchema: z.object({}),
      execute: async () => {
        const out: any = {
          user_id: ctx.userId,
          scope: ctx.scope,
          tenant_id: ctx.tenantId,
          is_platform_admin: ctx.isPlatformAdmin,
        };
        if (ctx.tenantId) {
          const { data: t } = await supa
            .from("tenants").select("name,slug").eq("id", ctx.tenantId).maybeSingle();
          out.tenant_name = (t as any)?.name ?? null;
          out.tenant_slug = (t as any)?.slug ?? null;
        }
        return out;
      },
    }),

    list_my_tenants: tool({
      description: "List tenants the user is a member of.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await supa
          .from("tenant_members")
          .select("role,active,tenants:tenants!inner(id,name,slug)")
          .eq("user_id", ctx.userId);
        if (error) return { error: error.message };
        return {
          memberships: (data ?? []).map((r: any) => ({
            tenant_id: r.tenants?.id,
            name: r.tenants?.name,
            slug: r.tenants?.slug,
            role: r.role,
            active: r.active,
          })),
        };
      },
    }),

    /* ─────────────────  PHASE 3: STRATEGIC DIAGNOSTIC + PORTFOLIO  ───────────────── */

    diagnose_recon_failure: tool({
      description:
        "Diagnose why a specific reconciliation run failed. Returns run summary, classified failure cause, likely root causes, similar past runs with their resolutions, and a recommended next action. Read-only.",
      inputSchema: z.object({ recon_run_id: z.string().uuid() }),
      execute: async ({ recon_run_id }) =>
        diagnoseReconFailure(supa, scopeOf(ctx), { reconRunId: recon_run_id }),
    }),

    schema_drift_detector: tool({
      description:
        "Platform admin: compare a tenant's current recon_definitions against a baseline (last published) and return added/removed/modified definitions with the first-drifted timestamp.",
      inputSchema: z.object({ tenant_id: z.string().uuid() }),
      execute: async ({ tenant_id }) => {
        if (!ctx.isPlatformAdmin) return { error: "platform_admin_required" };
        return schemaDriftDetector(supa, { tenantId: tenant_id });
      },
    }),

    cost_anomaly_alerter: tool({
      description:
        "Platform admin: compare last 7 days of AI cost against the prior 7 days. Returns delta_pct, top tenant and top model by delta, and possible causes.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!ctx.isPlatformAdmin) return { error: "platform_admin_required" };
        return costAnomalyAlerter(supa);
      },
    }),

    policy_auditor: tool({
      description:
        "Platform admin: list tenants/users with policy issues — overdue BYOK rotation, below-floor retention, expiring step-up grants, and missing 24h backups.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!ctx.isPlatformAdmin) return { error: "platform_admin_required" };
        return policyAuditor(supa);
      },
    }),

    cross_recon_intelligence: tool({
      description:
        "Platform admin: surface duplicate-field candidates and consolidation suggestions across a tenant's recon definitions.",
      inputSchema: z.object({ tenant_id: z.string().uuid() }),
      execute: async ({ tenant_id }) => {
        if (!ctx.isPlatformAdmin) return { error: "platform_admin_required" };
        return crossReconIntelligence(supa, { tenantId: tenant_id });
      },
    }),
  } as const;
}

export type CopilotToolName = keyof ReturnType<typeof buildCopilotTools>;

/* ════════════════════════════════════════════════════════════════════
 *  Standalone read-only helpers (also used by proactive briefing)
 * ════════════════════════════════════════════════════════════════════ */

export type TenantScope =
  | { type: "platform" }
  | { type: "tenant"; tenantId: string };

export function scopeOf(ctx: CopilotContext): TenantScope {
  if (ctx.isPlatformAdmin && ctx.scope === "platform") return { type: "platform" };
  if (ctx.tenantId) return { type: "tenant", tenantId: ctx.tenantId };
  return { type: "platform" };
}

function applyScope<T extends { eq: any }>(q: T, s: TenantScope): T {
  if (s.type === "tenant") return (q as any).eq("tenant_id", s.tenantId);
  return q;
}

/* ─────────────────  sla_at_risk  ───────────────── */

export interface SlaAtRiskResult {
  breaks_at_risk: number;
  reconciled_at_risk: number;
  worst_offenders: Array<{ id: string; name: string; sla_minutes_remaining: number }>;
}

export async function slaAtRisk(
  supabase: SupabaseClient,
  scope: TenantScope,
  args: { window: "today" | "24h" | "7d"; limit?: number },
): Promise<SlaAtRiskResult> {
  const limit = Math.max(1, Math.min(50, args.limit ?? 10));
  const nowMs = Date.now();
  const horizonMs =
    args.window === "today"
      ? new Date(new Date().setHours(23, 59, 59, 999)).getTime()
      : args.window === "24h"
      ? nowMs + 24 * 3600e3
      : nowMs + 7 * 86400e3;
  const horizonISO = new Date(horizonMs).toISOString();

  let q = supabase
    .from("break_sla_timers")
    .select("exception_id, due_resolution_at, resolved_at, breached_at")
    .is("breached_at", null)
    .is("resolved_at", null)
    .lt("due_resolution_at", horizonISO)
    .order("due_resolution_at", { ascending: true })
    .limit(limit);
  q = applyScope(q, scope);

  const { data, error } = await (q as any);
  if (error) {
    return { breaks_at_risk: 0, reconciled_at_risk: 0, worst_offenders: [] };
  }
  const rows = (data ?? []) as Array<{ exception_id: string; due_resolution_at: string }>;
  const offenders = rows.map((r) => ({
    id: r.exception_id,
    name: `Break ${String(r.exception_id ?? "").slice(0, 8)}`,
    sla_minutes_remaining: Math.round(
      (new Date(r.due_resolution_at).getTime() - nowMs) / 60_000,
    ),
  }));
  return {
    breaks_at_risk: rows.length,
    reconciled_at_risk: 0,
    worst_offenders: offenders,
  };
}

/* ─────────────────  anomaly_scan  ───────────────── */

export interface AnomalyScanResult {
  matches_dropped: number;
  latency_p95: number;
  new_failure_modes: Array<{ pattern: string; count: number; first_seen: string }>;
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length));
  return sorted[idx];
}

export async function anomalyScan(
  supabase: SupabaseClient,
  scope: TenantScope,
  args: { lookback_days: number },
): Promise<AnomalyScanResult> {
  const lookbackDays = Math.max(1, Math.min(90, args.lookback_days));
  const ms = lookbackDays * 86400e3;
  const nowISO = new Date().toISOString();
  const priorStart = new Date(Date.now() - 2 * ms).toISOString();
  const windowStart = new Date(Date.now() - ms).toISOString();

  let curQ = supabase
    .from("recon_runs")
    .select("status, matched_count, started_at, completed_at, error")
    .gte("started_at", windowStart)
    .lte("started_at", nowISO);
  curQ = applyScope(curQ, scope);

  let priorQ = supabase
    .from("recon_runs")
    .select("status, matched_count, started_at, completed_at, error")
    .gte("started_at", priorStart)
    .lt("started_at", windowStart);
  priorQ = applyScope(priorQ, scope);

  const [curRes, priorRes] = await Promise.all([curQ as any, priorQ as any]);
  if (curRes.error || priorRes.error) {
    return { matches_dropped: 0, latency_p95: 0, new_failure_modes: [] };
  }

  const cur = (curRes.data ?? []) as any[];
  const prior = (priorRes.data ?? []) as any[];
  const curMatches = cur.reduce((s, r) => s + (r.matched_count ?? 0), 0);
  const priorMatches = prior.reduce((s, r) => s + (r.matched_count ?? 0), 0);

  const latencies = cur
    .filter((r) => r.started_at && r.completed_at)
    .map((r) => new Date(r.completed_at).getTime() - new Date(r.started_at).getTime())
    .filter((n) => Number.isFinite(n) && n >= 0);

  const priorErrors = new Set(prior.map((r) => (r.error ?? "").trim()).filter(Boolean));
  const curErrorMap = new Map<string, { count: number; first_seen: string }>();
  for (const r of cur) {
    const e = (r.error ?? "").trim();
    if (!e || priorErrors.has(e)) continue;
    const prev = curErrorMap.get(e);
    if (prev) {
      prev.count++;
      if (r.started_at && r.started_at < prev.first_seen) prev.first_seen = r.started_at;
    } else {
      curErrorMap.set(e, { count: 1, first_seen: r.started_at ?? nowISO });
    }
  }
  const newFailureModes = Array.from(curErrorMap.entries())
    .map(([pattern, v]) => ({ pattern: pattern.slice(0, 200), ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    matches_dropped: Math.max(0, priorMatches - curMatches),
    latency_p95: p95(latencies),
    new_failure_modes: newFailureModes,
  };
}

/* ─────────────────  repeat_break_patterns  ───────────────── */

export interface RepeatBreakPattern {
  pattern_key: string;
  count: number;
  first_seen: string;
  last_seen: string;
  sample_break_ids: string[];
}

export async function repeatBreakPatterns(
  supabase: SupabaseClient,
  scope: TenantScope,
  args: { window_days: number; min_count: number },
): Promise<RepeatBreakPattern[]> {
  const windowDays = Math.max(1, Math.min(90, args.window_days));
  const minCount = Math.max(2, Math.min(1000, args.min_count));
  const sinceISO = new Date(Date.now() - windowDays * 86400e3).toISOString();

  let q = supabase
    .from("break_root_causes")
    .select("category, label, occurrence_count, first_seen_at, last_seen_at, representative_exception_id")
    .gte("last_seen_at", sinceISO)
    .gte("occurrence_count", minCount)
    .order("occurrence_count", { ascending: false })
    .limit(50);
  q = applyScope(q, scope);

  const { data, error } = await (q as any);
  if (error) return [];
  return ((data ?? []) as any[]).map((r) => ({
    pattern_key: `${r.category ?? "unknown"}::${r.label ?? "unlabelled"}`,
    count: r.occurrence_count ?? 0,
    first_seen: r.first_seen_at,
    last_seen: r.last_seen_at,
    sample_break_ids: r.representative_exception_id ? [r.representative_exception_id] : [],
  }));
}

/* ─────────────────  hybrid RAG search  ───────────────── */

export interface HybridSearchResult {
  mode: "hybrid" | "semantic" | "lexical" | "none";
  results: Array<{
    article_id: string;
    title: string;
    slug: string;
    scope: string;
    excerpt: string;
    score: number;
  }>;
}

const RRF_K = 60;
const TENANT_FRESHNESS_BOOST = 1.2;

const DIRECT_SEARCH_STOP_WORDS = new Set([
  "about", "answer", "article", "base", "cite", "concise", "does", "explain",
  "from", "have", "into", "keep", "knowledge", "please", "that", "the", "this",
  "using", "what", "when", "where", "which", "with", "would", "your",
]);

function directSearchTerms(query: string): string[] {
  return [...new Set(
    query
      .toLowerCase()
      .match(/[a-z0-9]+(?:-[a-z0-9]+)*/gu)
      ?.filter((term) => term.length >= 3 && !DIRECT_SEARCH_STOP_WORDS.has(term)) ?? [],
  )].slice(0, 16);
}

export interface DirectKbArticleRow {
  id: string;
  title: string | null;
  slug: string | null;
  scope: string | null;
  summary: string | null;
  body_md: string | null;
  tenant_id: string | null;
}

export function rankDirectKbArticles(
  query: string,
  rows: DirectKbArticleRow[],
  limit: number,
): Array<{
  article_id: string;
  title: string;
  slug: string;
  scope: string;
  content: string;
  tenant_id: string | null;
}> {
  const terms = directSearchTerms(query);
  if (terms.length === 0) return [];

  return rows
    .map((row) => {
      const title = row.title ?? "";
      const summary = row.summary ?? "";
      const body = row.body_md ?? "";
      const titleText = title.toLowerCase();
      const summaryText = summary.toLowerCase();
      const bodyText = body.toLowerCase();
      const score = terms.reduce(
        (total, term) => total
          + (titleText.includes(term) ? 8 : 0)
          + (summaryText.includes(term) ? 3 : 0)
          + (bodyText.includes(term) ? 1 : 0),
        0,
      );
      const firstMatch = terms
        .map((term) => bodyText.indexOf(term))
        .filter((index) => index >= 0)
        .sort((a, b) => a - b)[0] ?? 0;
      const excerptStart = Math.max(0, firstMatch - 120);
      return {
        row,
        score,
        result: {
          article_id: row.id,
          title,
          slug: row.slug ?? "",
          scope: row.scope ?? "",
          content: body.slice(excerptStart, excerptStart + 700),
          tenant_id: row.tenant_id,
        },
      };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.result.title.localeCompare(b.result.title))
    .slice(0, limit)
    .map(({ result }) => result);
}

export async function hybridSearchKb(
  ctx: CopilotContext,
  args: { query: string; k: number },
): Promise<HybridSearchResult> {
  const supa = ctx.supabase;
  const k = Math.max(1, Math.min(10, args.k ?? 5));

  type Cand = { chunk_id?: string; article_id: string; title: string; slug: string; scope: string; content?: string; tenant_id?: string | null };
  let semantic: Cand[] = [];
  try {
    const { embedQuery } = await import("./kb-embeddings.server");
    const vec = await embedQuery(supa, args.query);
    if (vec) {
      const { data } = await supa.rpc("match_kb_chunks", {
        query_embedding: vec as any,
        _tenant_id: ctx.tenantId,
        match_count: 20,
      });
      if (Array.isArray(data)) semantic = data as any[];
    }
  } catch { /* fallthrough */ }

  let lexical: Cand[] = [];
  try {
    const { data } = await supa.rpc("match_kb_chunks_lexical", {
      _query: args.query,
      _tenant_id: ctx.tenantId,
      match_count: 20,
    });
    if (Array.isArray(data)) lexical = data as any[];
  } catch { /* fallthrough */ }

  if (semantic.length === 0 && lexical.length === 0) {
    // A published article can temporarily lack kb_chunks while an embedding
    // backfill is pending. RLS still scopes this direct article read, so the
    // knowledge remains available without crossing tenant boundaries.
    const { data } = await supa
      .from("kb_articles")
      .select("id, title, slug, scope, summary, body_md, tenant_id")
      .eq("status", "published")
      .limit(500);
    const direct = rankDirectKbArticles(args.query, (data ?? []) as DirectKbArticleRow[], k);
    if (direct.length === 0) return { mode: "none", results: [] };
    lexical = direct;
  }

  const fused = new Map<string, { score: number; row: Cand }>();
  const keyOf = (r: Cand) => String(r.chunk_id ?? r.article_id);

  semantic.forEach((r, i) => {
    fused.set(keyOf(r), { score: 1 / (RRF_K + i + 1), row: r });
  });
  lexical.forEach((r, i) => {
    const k0 = keyOf(r);
    const s = 1 / (RRF_K + i + 1);
    const prev = fused.get(k0);
    if (prev) prev.score += s;
    else fused.set(k0, { score: s, row: r });
  });

  const boosted = Array.from(fused.values()).map(({ score, row }) => {
    const isTenantOwned =
      ctx.tenantId != null && row.tenant_id != null && row.tenant_id === ctx.tenantId;
    return {
      article_id: String(row.article_id),
      title: String(row.title ?? ""),
      slug: String(row.slug ?? ""),
      scope: String(row.scope ?? ""),
      excerpt: String(row.content ?? "").slice(0, 500),
      score: isTenantOwned ? score * TENANT_FRESHNESS_BOOST : score,
    };
  });
  boosted.sort((a, b) => b.score - a.score);

  const mode: HybridSearchResult["mode"] =
    semantic.length > 0 && lexical.length > 0
      ? "hybrid"
      : semantic.length > 0
      ? "semantic"
      : "lexical";

  return { mode, results: boosted.slice(0, k) };
}

/* ════════════════════════════════════════════════════════════════════
 *  Phase 3 — Strategic diagnostic + portfolio helpers
 * ════════════════════════════════════════════════════════════════════ */

export type DiagnoseReconFailureResult = {
  run_summary: {
    run_id: string;
    status: string;
    started_at: string | null;
    finished_at: string | null;
    error: string | null;
    duration_ms: number | null;
  };
  failure_cause: "auth" | "data_quality" | "rule_mismatch" | "timeout" | "unknown";
  likely_root_causes: Array<{ pattern: string; confidence: number }>;
  similar_past_runs: Array<{ run_id: string; resolution: string; days_to_resolve: number }>;
  recommended_next_action: string;
};

export async function diagnoseReconFailure(
  supabase: SupabaseClient,
  scope: TenantScope,
  args: { reconRunId: string },
): Promise<DiagnoseReconFailureResult | { error: string }> {
  let q = supabase
    .from("recon_runs")
    .select("id, recon_definition_id, tenant_id, status, started_at, finished_at, error_message")
    .eq("id", args.reconRunId);
  if (scope.type === "tenant") q = q.eq("tenant_id", scope.tenantId);
  const { data: run, error } = await q.maybeSingle();
  if (error || !run) return { error: error?.message ?? "run_not_found" };
  const r = run as {
    id: string;
    recon_definition_id: string;
    tenant_id: string;
    status: string;
    started_at: string | null;
    finished_at: string | null;
    error_message: string | null;
  };

  const cause = classifyFailureCause(r.error_message);
  const duration_ms =
    r.started_at && r.finished_at
      ? Date.parse(r.finished_at) - Date.parse(r.started_at)
      : null;

  const since = new Date(Date.now() - 30 * 86400e3).toISOString();
  const { data: history } = await supabase
    .from("recon_runs")
    .select("id, status, error_message, finished_at, started_at")
    .eq("recon_definition_id", r.recon_definition_id)
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(50);

  const histRows = (history ?? []) as Array<{
    id: string;
    status: string;
    error_message: string | null;
    finished_at: string | null;
    started_at: string | null;
  }>;

  const patterns = new Map<string, number>();
  for (const h of histRows) {
    if (!h.error_message) continue;
    const key = classifyFailureCause(h.error_message);
    patterns.set(key, (patterns.get(key) ?? 0) + 1);
  }
  const likely_root_causes = Array.from(patterns.entries())
    .map(([pattern, count]) => ({ pattern, confidence: Math.min(1, count / Math.max(histRows.length, 1)) }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);

  const similar_past_runs = histRows
    .filter((h) => h.id !== r.id && classifyFailureCause(h.error_message) === cause && h.status === "succeeded")
    .slice(0, 5)
    .map((h) => ({
      run_id: h.id,
      resolution: "succeeded after re-run",
      days_to_resolve: h.finished_at && r.started_at
        ? Math.max(0, Math.round((Date.parse(h.finished_at) - Date.parse(r.started_at)) / 86400e3))
        : 0,
    }));

  return {
    run_summary: {
      run_id: r.id,
      status: r.status,
      started_at: r.started_at,
      finished_at: r.finished_at,
      error: r.error_message,
      duration_ms,
    },
    failure_cause: cause,
    likely_root_causes,
    similar_past_runs,
    recommended_next_action: recommendNextAction(cause),
  };
}

function classifyFailureCause(err: string | null): DiagnoseReconFailureResult["failure_cause"] {
  if (!err) return "unknown";
  const e = err.toLowerCase();
  if (/auth|unauthor|forbidden|401|403|token|credential/.test(e)) return "auth";
  if (/timeout|deadline|timed out|504/.test(e)) return "timeout";
  if (/parse|schema|column|missing field|invalid (date|amount|number)/.test(e)) return "data_quality";
  if (/rule|tolerance|match|threshold/.test(e)) return "rule_mismatch";
  return "unknown";
}

function recommendNextAction(cause: DiagnoseReconFailureResult["failure_cause"]): string {
  switch (cause) {
    case "auth": return "Rotate the data-source credential and re-run; verify it is not expired.";
    case "timeout": return "Re-run with a narrower date window; check upstream worker queue depth.";
    case "data_quality": return "Open the latest source file in ReconIQ Studio → Validate to find the offending row, then patch the parser and re-run.";
    case "rule_mismatch": return "Open the recon's rule set, review tolerance ladder, and re-run after adjusting.";
    default: return "Re-run with verbose logging; if it reoccurs, open a Support ticket with this run id.";
  }
}

export type SchemaDriftResult = {
  added: string[];
  removed: string[];
  modified: Array<{ key: string; field: string; before: unknown; after: unknown }>;
  first_drifted_at: string | null;
};

export async function schemaDriftDetector(
  supabase: SupabaseClient,
  args: { tenantId: string },
): Promise<SchemaDriftResult> {
  const { data: current } = await supabase
    .from("recon_definitions")
    .select("id, name, status, version, updated_at")
    .eq("tenant_id", args.tenantId);
  const { data: versions } = await supabase
    .from("recon_definition_versions")
    .select("recon_definition_id, version, snapshot_json, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  const cur = new Map((current ?? []).map((d: any) => [String(d.id), d]));
  const baselineByDef = new Map<string, any>();
  for (const v of (versions ?? []) as any[]) {
    if (!baselineByDef.has(v.recon_definition_id)) baselineByDef.set(v.recon_definition_id, v);
  }

  const added: string[] = [];
  const removed: string[] = [];
  const modified: SchemaDriftResult["modified"] = [];
  let firstDrift: string | null = null;

  for (const [id, def] of cur) {
    const base = baselineByDef.get(id);
    if (!base) { added.push(String(def.name ?? id)); continue; }
    const bv = Number(base.version ?? 0);
    const dv = Number(def.version ?? 0);
    if (dv !== bv) {
      modified.push({ key: String(def.name ?? id), field: "version", before: bv, after: dv });
      const ts = def.updated_at ?? base.created_at;
      if (ts && (!firstDrift || ts < firstDrift)) firstDrift = ts;
    }
  }
  for (const [id, base] of baselineByDef) {
    if (!cur.has(id)) removed.push(String((base.snapshot_json as any)?.name ?? id));
  }

  return { added, removed, modified, first_drifted_at: firstDrift };
}

export type CostAnomalyResult = {
  current_week_cost_usd: number;
  prior_week_cost_usd: number;
  delta_pct: number;
  top_tenant: { tenant_id: string | null; delta_pct: number };
  top_model: { model: string; delta_pct: number };
  possible_causes: string[];
};

export async function costAnomalyAlerter(supabase: SupabaseClient): Promise<CostAnomalyResult> {
  const now = Date.now();
  const wk = 7 * 86400e3;
  const curStart = new Date(now - wk).toISOString();
  const prevStart = new Date(now - 2 * wk).toISOString();
  const { data } = await supabase
    .from("ai_usage_events")
    .select("tenant_id, model, cost_usd, created_at")
    .gte("created_at", prevStart);
  const rows = (data ?? []) as Array<{ tenant_id: string | null; model: string | null; cost_usd: number | null; created_at: string }>;

  const sum = (arr: typeof rows) => arr.reduce((a, r) => a + Number(r.cost_usd ?? 0), 0);
  const current = rows.filter((r) => r.created_at >= curStart);
  const prior = rows.filter((r) => r.created_at < curStart);
  const cur = sum(current);
  const prv = sum(prior);
  const delta = prv > 0 ? ((cur - prv) / prv) * 100 : (cur > 0 ? 100 : 0);

  const groupDelta = <K extends string | null>(
    keyFn: (r: typeof rows[number]) => K,
  ) => {
    const c = new Map<K, number>();
    const p = new Map<K, number>();
    for (const r of current) c.set(keyFn(r), (c.get(keyFn(r)) ?? 0) + Number(r.cost_usd ?? 0));
    for (const r of prior) p.set(keyFn(r), (p.get(keyFn(r)) ?? 0) + Number(r.cost_usd ?? 0));
    let bestKey: K | null = null;
    let bestDelta = -Infinity;
    for (const [k, cv] of c) {
      const pv = p.get(k) ?? 0;
      const d = pv > 0 ? ((cv - pv) / pv) * 100 : (cv > 0 ? 100 : 0);
      if (d > bestDelta) { bestDelta = d; bestKey = k; }
    }
    return { key: bestKey, delta_pct: Number(bestDelta.toFixed(2)) };
  };

  const tTop = groupDelta((r) => r.tenant_id);
  const mTop = groupDelta((r) => (r.model ?? "unknown"));

  const causes: string[] = [];
  if (delta > 50) causes.push("Week-over-week cost up >50% — review tenant budgets.");
  if (tTop.delta_pct > 100) causes.push(`Tenant ${tTop.key ?? "?"} doubled spend — check for runaway agent loops.`);
  if (mTop.delta_pct > 100) causes.push(`Model ${mTop.key ?? "?"} spend doubled — check default model rollout.`);
  if (causes.length === 0) causes.push("No anomalies detected in the last 7-day window.");

  return {
    current_week_cost_usd: Number(cur.toFixed(4)),
    prior_week_cost_usd: Number(prv.toFixed(4)),
    delta_pct: Number(delta.toFixed(2)),
    top_tenant: { tenant_id: tTop.key, delta_pct: tTop.delta_pct },
    top_model: { model: String(mTop.key ?? "unknown"), delta_pct: mTop.delta_pct },
    possible_causes: causes,
  };
}

export type PolicyAuditorResult = {
  overdue_byok_rotation: Array<{ tenant_id: string; days_overdue: number }>;
  below_floor_retention: Array<{ tenant_id: string; table_name: string; configured_days: number; floor_days: number }>;
  expiring_step_up_grants: Array<{ user_id: string; tenant_id: string; expires_at: string }>;
  missing_backups_24h: Array<{ tenant_id: string; last_backup_at: string | null }>;
};

export async function policyAuditor(supabase: SupabaseClient): Promise<PolicyAuditorResult> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400e3).toISOString();
  const oneDayAhead = new Date(Date.now() + 86400e3).toISOString();
  const oneDayAgo = new Date(Date.now() - 86400e3).toISOString();

  const [{ data: keys }, { data: retOver }, { data: grants }] = await Promise.all([
    supabase
      .from("byok_keys")
      .select("tenant_id, last_rotated_at, created_at")
      .lt("last_rotated_at", ninetyDaysAgo)
      .limit(50),
    supabase
      .from("tenant_retention_overrides")
      .select("tenant_id, table_name, configured_days, floor_days")
      .limit(50),
    supabase
      .from("step_up_grants")
      .select("user_id, tenant_id, expires_at")
      .gt("expires_at", new Date().toISOString())
      .lt("expires_at", oneDayAhead)
      .limit(50),
  ]);

  const overdue = ((keys ?? []) as any[]).map((k) => ({
    tenant_id: String(k.tenant_id),
    days_overdue: Math.max(
      0,
      Math.round((Date.now() - Date.parse(k.last_rotated_at ?? k.created_at)) / 86400e3) - 90,
    ),
  }));
  const belowFloor = ((retOver ?? []) as any[])
    .filter((r) => Number(r.configured_days) < Number(r.floor_days))
    .map((r) => ({
      tenant_id: String(r.tenant_id),
      table_name: String(r.table_name),
      configured_days: Number(r.configured_days),
      floor_days: Number(r.floor_days),
    }));
  const expiring = ((grants ?? []) as any[]).map((g) => ({
    user_id: String(g.user_id),
    tenant_id: String(g.tenant_id),
    expires_at: String(g.expires_at),
  }));

  // missing_backups_24h — naive: every tenant minus those with a verified
  // anchor in the last 24h.
  const { data: anchors } = await supabase
    .from("audit_anchors")
    .select("tenant_id, anchored_at")
    .gte("anchored_at", oneDayAgo);
  const seen = new Set<string>(((anchors ?? []) as any[]).map((a) => String(a.tenant_id)));
  const { data: tenants } = await supabase.from("tenants").select("id");
  const missing = ((tenants ?? []) as any[])
    .filter((t) => !seen.has(String(t.id)))
    .slice(0, 50)
    .map((t) => ({ tenant_id: String(t.id), last_backup_at: null }));

  return {
    overdue_byok_rotation: overdue,
    below_floor_retention: belowFloor,
    expiring_step_up_grants: expiring,
    missing_backups_24h: missing,
  };
}

export type CrossReconIntelligenceResult = {
  duplicate_field_candidates: Array<{ field_name: string; recon_definition_count: number; sample_recon_ids: string[] }>;
  consolidation_suggestions: Array<{ recon_a: string; recon_b: string; shared_fields: string[]; rationale: string }>;
};

export async function crossReconIntelligence(
  supabase: SupabaseClient,
  args: { tenantId: string },
): Promise<CrossReconIntelligenceResult> {
  const { data: defs } = await supabase
    .from("recon_definitions")
    .select("id, name, schema_json")
    .eq("tenant_id", args.tenantId);
  const rows = (defs ?? []) as Array<{ id: string; name: string; schema_json: any }>;

  const fieldMap = new Map<string, string[]>();
  for (const d of rows) {
    const fields = Array.isArray(d.schema_json?.fields) ? d.schema_json.fields : [];
    for (const f of fields) {
      const name = String(f?.name ?? f).toLowerCase();
      if (!name) continue;
      const arr = fieldMap.get(name) ?? [];
      arr.push(d.id);
      fieldMap.set(name, arr);
    }
  }

  const duplicates = Array.from(fieldMap.entries())
    .filter(([, ids]) => ids.length >= 3)
    .map(([field_name, ids]) => ({
      field_name,
      recon_definition_count: ids.length,
      sample_recon_ids: ids.slice(0, 5),
    }))
    .sort((a, b) => b.recon_definition_count - a.recon_definition_count)
    .slice(0, 20);

  const suggestions: CrossReconIntelligenceResult["consolidation_suggestions"] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      const af = new Set<string>((a.schema_json?.fields ?? []).map((f: any) => String(f?.name ?? f).toLowerCase()));
      const bf = new Set<string>((b.schema_json?.fields ?? []).map((f: any) => String(f?.name ?? f).toLowerCase()));
      const shared: string[] = Array.from(af).filter((x) => bf.has(x));
      
      const overlap = shared.length / Math.max(Math.min(af.size, bf.size), 1);
      if (overlap >= 0.7 && shared.length >= 5) {
        suggestions.push({
          recon_a: a.name,
          recon_b: b.name,
          shared_fields: shared.slice(0, 12),
          rationale: `${Math.round(overlap * 100)}% field overlap — candidate for a shared template.`,
        });
      }
      if (suggestions.length >= 10) break;
    }
    if (suggestions.length >= 10) break;
  }
  return { duplicate_field_candidates: duplicates, consolidation_suggestions: suggestions };
}
