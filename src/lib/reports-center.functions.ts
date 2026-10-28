import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

function dayKey(d: Date) { return d.toISOString().slice(0, 10); }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0, 0, 0, 0); return d; }

export const getReportsCenter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      days: z.number().int().min(7).max(180).default(30),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const t = data.tenant_id;
    const W = data.days;
    const since = daysAgo(W).toISOString();
    const prevSince = daysAgo(W * 2).toISOString();

    const [
      auditR, secR, aiR, runsR, excR, ticketsR, schedulesR, ipR, sso, sec, ai_settings, members,
    ] = await Promise.all([
      supabase.from("audit_log").select("id, occurred_at, actor_email, scope, action, resource_type, client_ip").eq("tenant_id", t).gte("occurred_at", since).limit(5000),
      supabase.from("security_events").select("id, occurred_at, event_type, severity, ip, user_id").eq("tenant_id", t).gte("occurred_at", since).limit(2000),
      supabase.from("ai_usage_events").select("id, created_at, scope, model, tokens_in, tokens_out, cost_usd, user_id").eq("tenant_id", t).gte("created_at", since).limit(5000),
      supabase.from("recon_runs").select("id, started_at, completed_at, matched_count, exception_count, status, definition_id").eq("tenant_id", t).gte("started_at", since).limit(3000),
      supabase.from("recon_exceptions").select("id, severity, priority, lifecycle_state, status, created_at, resolved_at, due_date, root_cause").eq("tenant_id", t).gte("created_at", prevSince).limit(5000),
      supabase.from("support_tickets").select("id, status, priority, created_at, resolved_at").eq("tenant_id", t).gte("created_at", since).limit(1000),
      supabase.from("recon_schedules").select("id, enabled").eq("tenant_id", t),
      supabase.from("tenant_ip_allowlist").select("id").eq("tenant_id", t),
      supabase.from("tenant_sso_configs").select("id, enabled, provider").eq("tenant_id", t),
      supabase.from("tenant_security_settings").select("*").eq("tenant_id", t).maybeSingle(),
      supabase.from("tenant_ai_settings").select("*").eq("tenant_id", t).maybeSingle(),
      supabase.from("tenant_members").select("user_id, role").eq("tenant_id", t),
    ]);

    const audit = auditR.data ?? [];
    const security_events = secR.data ?? [];
    const ai = aiR.data ?? [];
    const runs = runsR.data ?? [];
    const excAll = excR.data ?? [];
    const exc = excAll.filter((e: any) => new Date(e.created_at) >= new Date(since));
    const excPrev = excAll.filter((e: any) => new Date(e.created_at) < new Date(since));
    const tickets = ticketsR.data ?? [];
    const schedules = schedulesR.data ?? [];

    // ---------- helpers ----------
    const bucket: Record<string, any> = {};
    for (let i = 0; i <= W; i++) bucket[dayKey(daysAgo(W - i))] = { day: dayKey(daysAgo(W - i)) };
    const merge = (k: string, field: string, v: number) => {
      const row = bucket[k]; if (!row) return; row[field] = (row[field] ?? 0) + v;
    };

    // ---------- OPERATIONS ----------
    let totalMatched = 0, totalExc = 0;
    for (const r of runs) {
      const k = (r.started_at ?? "").slice(0, 10);
      merge(k, "matched", r.matched_count ?? 0);
      merge(k, "exceptions", r.exception_count ?? 0);
      merge(k, "runs", 1);
      totalMatched += r.matched_count ?? 0;
      totalExc += r.exception_count ?? 0;
    }
    const matchRate = totalMatched + totalExc > 0 ? +(100 * totalMatched / (totalMatched + totalExc)).toFixed(1) : 0;
    const successRuns = runs.filter((r: any) => r.status === "succeeded" || r.status === "completed").length;
    const failedRuns = runs.filter((r: any) => r.status === "failed").length;
    const avgRuntimeSec = (() => {
      const arr = runs.filter((r: any) => r.completed_at && r.started_at)
        .map((r: any) => (new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 1000);
      return arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : 0;
    })();

    // ---------- MATCH RATES trend ----------
    const trend = Object.values(bucket).map((r: any) => {
      const m = r.matched ?? 0, e = r.exceptions ?? 0;
      return { day: r.day, matched: m, exceptions: e, runs: r.runs ?? 0, rate: m + e ? +(100 * m / (m + e)).toFixed(1) : null };
    });

    // ---------- TREND ANALYSIS (period over period) ----------
    const prevMatched = excPrev.length;
    const curMatched = exc.length;
    const wow = prevMatched ? Math.round(((curMatched - prevMatched) / prevMatched) * 100) : 0;

    // ---------- RISK ----------
    const open = exc.filter((e: any) => !["resolved", "written_off"].includes(e.lifecycle_state) && e.status !== "resolved" && e.status !== "wont_fix");
    const overdue = exc.filter((e: any) => e.due_date && new Date(e.due_date) < new Date() && !["resolved", "written_off"].includes(e.lifecycle_state));
    const sevCounts: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const e of exc) sevCounts[e.severity ?? "medium"] = (sevCounts[e.severity ?? "medium"] ?? 0) + 1;
    const severity = Object.entries(sevCounts).map(([name, value]) => ({ name, value }));
    const rootCauses: Record<string, number> = {};
    for (const e of exc) if (e.root_cause) rootCauses[e.root_cause] = (rootCauses[e.root_cause] ?? 0) + 1;
    const top_root_causes = Object.entries(rootCauses).map(([k, v]) => ({ name: k, value: v })).sort((a, b) => b.value - a.value).slice(0, 8);
    const riskScore = Math.min(100, Math.round(
      (open.length * 1) + (overdue.length * 3) + (sevCounts.critical * 5) + (sevCounts.high * 2) + (failedRuns * 4),
    ));

    // ---------- AI USAGE ----------
    let tokIn = 0, tokOut = 0, cost = 0;
    const aiByModel: Record<string, { tokens: number; cost: number; calls: number }> = {};
    const aiByScope: Record<string, number> = {};
    for (const a of ai) {
      tokIn += a.tokens_in ?? 0; tokOut += a.tokens_out ?? 0; cost += Number(a.cost_usd ?? 0);
      const m = a.model ?? "unknown";
      aiByModel[m] = aiByModel[m] ?? { tokens: 0, cost: 0, calls: 0 };
      aiByModel[m].tokens += (a.tokens_in ?? 0) + (a.tokens_out ?? 0);
      aiByModel[m].cost += Number(a.cost_usd ?? 0);
      aiByModel[m].calls += 1;
      aiByScope[a.scope ?? "general"] = (aiByScope[a.scope ?? "general"] ?? 0) + 1;
      const k = (a.created_at ?? "").slice(0, 10);
      merge(k, "ai_cost", Number(a.cost_usd ?? 0));
      merge(k, "ai_tokens", (a.tokens_in ?? 0) + (a.tokens_out ?? 0));
    }
    const ai_trend = Object.values(bucket).map((r: any) => ({ day: r.day, cost: +(r.ai_cost ?? 0).toFixed(4), tokens: r.ai_tokens ?? 0 }));
    const ai_models = Object.entries(aiByModel).map(([name, v]) => ({ name, ...v, cost: +v.cost.toFixed(4) })).sort((a, b) => b.tokens - a.tokens);
    const ai_scopes = Object.entries(aiByScope).map(([name, value]) => ({ name, value }));

    // ---------- SECURITY ----------
    const secByType: Record<string, number> = {};
    const secBySev: Record<string, number> = {};
    for (const s of security_events) {
      secByType[s.event_type ?? "other"] = (secByType[s.event_type ?? "other"] ?? 0) + 1;
      secBySev[s.severity ?? "info"] = (secBySev[s.severity ?? "info"] ?? 0) + 1;
    }
    const security_type_mix = Object.entries(secByType).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10);
    const security_severity = Object.entries(secBySev).map(([name, value]) => ({ name, value }));
    const failedLogins = security_events.filter((s: any) => /fail|denied|invalid|lock/i.test(s.event_type ?? "")).length;
    const uniqueIps = new Set(security_events.map((s: any) => s.ip).filter(Boolean)).size;

    // ---------- COMPLIANCE ----------
    const ssoEnabled = (sso.data ?? []).some((s: any) => s.enabled);
    const ipEnforced = (ipR.data ?? []).length > 0;
    const secSettings = (sec.data as any) ?? {};
    const aiSettings = (ai_settings.data as any) ?? {};
    const compliance = {
      checks: [
        { id: "sso", name: "Single sign-on configured", ok: ssoEnabled, control: "ISO 27001 A.9.4 · SOC 2 CC6.1" },
        { id: "ip", name: "IP allow-list enforced", ok: ipEnforced, control: "SOC 2 CC6.6" },
        { id: "mfa", name: "MFA required for admins", ok: !!secSettings?.require_mfa, control: "ISO 27001 A.9.4.2" },
        { id: "session", name: "Session max-age configured", ok: !!secSettings?.session_max_age_minutes, control: "SOC 2 CC6.1" },
        { id: "audit", name: "Audit chain emitting events", ok: audit.length > 0, control: "SOC 2 CC7.3" },
        { id: "ai_redact", name: "PII redaction enabled for AI", ok: aiSettings?.pii_redaction !== false, control: "GDPR Art.25" },
        { id: "ai_budget", name: "AI budget enforced", ok: !!aiSettings?.monthly_budget_usd, control: "Internal cost control" },
        { id: "schedules", name: "At least one active schedule", ok: schedules.some((s: any) => s.enabled), control: "Operational readiness" },
      ],
    };
    const compScore = Math.round(100 * compliance.checks.filter((c) => c.ok).length / compliance.checks.length);

    // ---------- AUDIT ----------
    const auditByAction: Record<string, number> = {};
    const auditByActor: Record<string, number> = {};
    const auditByScope: Record<string, number> = {};
    for (const a of audit) {
      auditByAction[a.action ?? "?"] = (auditByAction[a.action ?? "?"] ?? 0) + 1;
      const who = a.actor_email ?? "system";
      auditByActor[who] = (auditByActor[who] ?? 0) + 1;
      auditByScope[a.scope ?? "?"] = (auditByScope[a.scope ?? "?"] ?? 0) + 1;
      const k = (a.occurred_at ?? "").slice(0, 10);
      merge(k, "audit_events", 1);
    }
    const audit_trend = Object.values(bucket).map((r: any) => ({ day: r.day, events: r.audit_events ?? 0 }));
    const audit_top_actions = Object.entries(auditByAction).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10);
    const audit_top_actors = Object.entries(auditByActor).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10);
    const audit_scope_mix = Object.entries(auditByScope).map(([name, value]) => ({ name, value }));

    return {
      window_days: W,
      generated_at: new Date().toISOString(),
      operations: {
        runs: runs.length,
        success: successRuns,
        failed: failedRuns,
        avg_runtime_sec: avgRuntimeSec,
        match_rate_pct: matchRate,
        matched: totalMatched,
        exceptions: totalExc,
        active_schedules: schedules.filter((s: any) => s.enabled).length,
        tickets_open: tickets.filter((t: any) => t.status !== "resolved" && t.status !== "closed").length,
        members: (members.data ?? []).length,
      },
      match_rates: { trend, severity, top_root_causes },
      trends: { wow_exceptions_pct: wow, current: curMatched, previous: prevMatched },
      risk: {
        score: riskScore,
        open_breaks: open.length,
        overdue: overdue.length,
        critical: sevCounts.critical,
        high: sevCounts.high,
        severity,
        top_root_causes,
      },
      ai_usage: {
        tokens_in: tokIn, tokens_out: tokOut, total_tokens: tokIn + tokOut, cost_usd: +cost.toFixed(4),
        calls: ai.length, trend: ai_trend, by_model: ai_models, by_scope: ai_scopes,
      },
      security: {
        events_total: security_events.length,
        failed_logins: failedLogins,
        unique_ips: uniqueIps,
        type_mix: security_type_mix,
        severity_mix: security_severity,
      },
      compliance: { score: compScore, ...compliance },
      audit: {
        events_total: audit.length,
        trend: audit_trend,
        top_actions: audit_top_actions,
        top_actors: audit_top_actors,
        scope_mix: audit_scope_mix,
      },
    };
  });
