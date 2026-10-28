// Continuous security monitoring: rule CRUD, evaluator trigger, incidents, audit export.
// Covers Phase 6–8 critical flows (ABAC, master data, residency, BYOK, break-glass,
// chaos drills, silo, GitHub sync, red-team, AI residency blocks, cron, auth bursts).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantAdmin } from "@/lib/rbac-guards.server";

async function isPlatformAdmin(ctx: any): Promise<boolean> {
  const { data } = await ctx.supabase.rpc("is_platform_admin", { _user_id: ctx.userId });
  return Boolean(data);
}

async function assertTenantAdminOrPlatform(ctx: any, tenant_id: string) {
  await requireTenantAdmin(ctx, tenant_id, { fnName: "security-monitoring" });
}

// ---------- Rules ----------

export const listSecurityAlertRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: z.string().uuid().nullable().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const platform = await isPlatformAdmin(context);
    let q = context.supabase
      .from("security_alert_rules")
      .select("*")
      .order("tenant_id", { ascending: true, nullsFirst: true })
      .order("code");
    if (!platform) {
      if (!data.tenant_id) throw new Error("tenant_id required");
      await assertTenantAdminOrPlatform(context, data.tenant_id);
      q = q.or(`tenant_id.eq.${data.tenant_id},tenant_id.is.null`);
    } else if (data.tenant_id) {
      q = q.or(`tenant_id.eq.${data.tenant_id},tenant_id.is.null`);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const upsertRuleSchema = z.object({
  id: z.string().uuid().optional(),
  tenant_id: z.string().uuid().nullable(),
  code: z.string().trim().min(2).max(64).regex(/^[a-z0-9_]+$/),
  description: z.string().trim().max(500).optional(),
  event_type_pattern: z.string().trim().min(1).max(200),
  min_severity: z.enum(["info", "warning", "critical"]).default("info"),
  window_minutes: z.number().int().min(1).max(1440),
  threshold: z.number().int().min(1),
  cooldown_minutes: z.number().int().min(1).max(1440),
  severity: z.enum(["info", "warning", "critical"]),
  notify_channels: z.array(z.string()).default(["in_app"]),
  enabled: z.boolean(),
});

export const upsertSecurityAlertRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => upsertRuleSchema.parse(d))
  .handler(async ({ data, context }) => {
    // Platform-wide rules (tenant_id null): platform admin only.
    // Per-tenant rules: platform admin only too (defence-in-depth — RLS already enforces).
    if (!(await isPlatformAdmin(context))) {
      throw new Error("Forbidden: platform admin required to manage security alert rules");
    }
    const row = {
      tenant_id: data.tenant_id,
      code: data.code,
      description: data.description ?? null,
      event_type_pattern: data.event_type_pattern,
      min_severity: data.min_severity,
      window_minutes: data.window_minutes,
      threshold: data.threshold,
      cooldown_minutes: data.cooldown_minutes,
      severity: data.severity,
      notify_channels: data.notify_channels,
      enabled: data.enabled,
      updated_by: context.userId,
    };
    const q = data.id
      ? context.supabase.from("security_alert_rules").update(row).eq("id", data.id).select("*").single()
      : context.supabase
          .from("security_alert_rules")
          .insert({ ...row, created_by: context.userId })
          .select("*")
          .single();
    const { data: out, error } = await q;
    if (error) throw new Error(error.message);
    return out;
  });

export const deleteSecurityAlertRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isPlatformAdmin(context))) throw new Error("Forbidden");
    const { data: row } = await context.supabase
      .from("security_alert_rules").select("tenant_id").eq("id", data.id).maybeSingle();
    if (row && row.tenant_id === null) {
      throw new Error("Platform-wide rules cannot be deleted; disable them instead");
    }
    const { error } = await context.supabase
      .from("security_alert_rules").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Evaluator (manual trigger; cron route also calls the RPC) ----------

export const evaluateSecurityAlertsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    if (!(await isPlatformAdmin(context))) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("evaluate_security_alerts" as any);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ---------- Incidents ----------

export const listSecurityAlertIncidents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        tenant_id: z.string().uuid().optional(),
        since_hours: z.number().int().min(1).max(24 * 90).default(24 * 7),
        limit: z.number().int().min(1).max(500).default(100),
        only_unacknowledged: z.boolean().default(false),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    if (data.tenant_id) await assertTenantAdminOrPlatform(context, data.tenant_id);
    else if (!(await isPlatformAdmin(context))) throw new Error("Forbidden");
    const since = new Date(Date.now() - data.since_hours * 3600_000).toISOString();
    let q = context.supabase
      .from("security_alert_incidents")
      .select("*, rule:security_alert_rules(code, description, severity)")
      .gte("fired_at", since)
      .order("fired_at", { ascending: false })
      .limit(data.limit);
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    if (data.only_unacknowledged) q = q.is("acknowledged_at", null);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const acknowledgeSecurityAlertIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: inc } = await context.supabase
      .from("security_alert_incidents").select("tenant_id").eq("id", data.id).maybeSingle();
    if (inc?.tenant_id) await assertTenantAdminOrPlatform(context, inc.tenant_id);
    else if (!(await isPlatformAdmin(context))) throw new Error("Forbidden");
    const { error } = await context.supabase
      .from("security_alert_incidents")
      .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: context.userId })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Audit / security_events export (CSV string for download) ----------

const exportSchema = z.object({
  tenant_id: z.string().uuid(),
  since_hours: z.number().int().min(1).max(24 * 365).default(24 * 30),
  source: z.enum(["audit_log", "security_events", "alert_incidents"]).default("security_events"),
  event_type_prefix: z.string().trim().max(64).optional(),
  max_rows: z.number().int().min(1).max(50_000).default(10_000),
});

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const exportSecurityAuditCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => exportSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdminOrPlatform(context, data.tenant_id);
    const since = new Date(Date.now() - data.since_hours * 3600_000).toISOString();

    let rows: Array<Record<string, unknown>> = [];
    let columns: string[] = [];

    if (data.source === "security_events") {
      let q = context.supabase
        .from("security_events")
        .select("id, occurred_at, tenant_id, user_id, event_type, severity, ip, context")
        .eq("tenant_id", data.tenant_id)
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: false })
        .limit(data.max_rows);
      if (data.event_type_prefix) q = q.ilike("event_type", `${data.event_type_prefix}%`);
      const { data: r, error } = await q;
      if (error) throw new Error(error.message);
      rows = r ?? [];
      columns = ["id", "occurred_at", "tenant_id", "user_id", "event_type", "severity", "ip", "context"];
    } else if (data.source === "audit_log") {
      let q = context.supabase
        .from("audit_log")
        .select("id, occurred_at, actor_email, action, scope, resource_type, resource_id, client_ip, context")
        .eq("tenant_id", data.tenant_id)
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: false })
        .limit(data.max_rows);
      if (data.event_type_prefix) q = q.ilike("action", `${data.event_type_prefix}%`);
      const { data: r, error } = await q;
      if (error) throw new Error(error.message);
      rows = r ?? [];
      columns = ["id", "occurred_at", "actor_email", "action", "scope", "resource_type", "resource_id", "client_ip", "context"];
    } else {
      const { data: r, error } = await context.supabase
        .from("security_alert_incidents")
        .select("id, fired_at, rule_id, tenant_id, event_count, window_minutes, severity, acknowledged_at, context")
        .eq("tenant_id", data.tenant_id)
        .gte("fired_at", since)
        .order("fired_at", { ascending: false })
        .limit(data.max_rows);
      if (error) throw new Error(error.message);
      rows = r ?? [];
      columns = ["id", "fired_at", "rule_id", "tenant_id", "event_count", "window_minutes", "severity", "acknowledged_at", "context"];
    }

    const header = columns.join(",");
    const body = rows.map((r) => columns.map((c) => csvEscape((r as any)[c])).join(",")).join("\n");
    const csv = `${header}\n${body}\n`;

    // Best-effort audit trail of the export itself.
    try {
      await context.supabase.from("security_events").insert({
        event_type: "audit.export",
        severity: "info",
        tenant_id: data.tenant_id,
        user_id: context.userId,
        context: {
          source: data.source,
          since_hours: data.since_hours,
          row_count: rows.length,
          event_type_prefix: data.event_type_prefix ?? null,
        },
      } as never);
    } catch { /* swallow */ }

    return {
      filename: `fvi-${data.source}-${data.tenant_id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`,
      content_type: "text/csv",
      row_count: rows.length,
      csv,
    };
  });

// ---------- Coverage report (Phase 6–8 critical flows) ----------

export const securityMonitoringCoverage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    if (!(await isPlatformAdmin(context))) throw new Error("Forbidden");
    const REQUIRED = [
      { area: "Phase 6 — ABAC predicate write",   code: "abac_predicate_write" },
      { area: "Phase 6 — Master data mutation",    code: "master_data_write" },
      { area: "Phase 6 — Residency change",        code: "residency_change" },
      { area: "Phase 6 — AI residency block",      code: "ai_residency_block" },
      { area: "Phase 6 — BYOK / CMEK rotation",    code: "byok_rotate" },
      { area: "Cross — Break-glass grant",         code: "break_glass_granted" },
      { area: "Phase 7 — Red-team scan",           code: "red_team_scan" },
      { area: "Phase 7 — GitHub sync change",      code: "github_sync_change" },
      { area: "Phase 8 — Chaos drill",             code: "chaos_drill_started" },
      { area: "Phase 8 — Silo assignment",         code: "silo_assignment" },
      { area: "Auth — Failed sign-in burst",       code: "auth_failure_spike" },
      { area: "Auth — Step-up failures",           code: "step_up_failure" },
      { area: "Infra — Cron unauthorized",         code: "cron_unauthorized" },
      { area: "Infra — Rate limit p99 high",       code: "rate_limit_p99_high" },
    ] as const;
    const { data: rules } = await context.supabase
      .from("security_alert_rules")
      .select("code, enabled, last_triggered_at")
      .is("tenant_id", null);
    const have = new Set((rules ?? []).filter((r: any) => r.enabled).map((r: any) => r.code));
    const lastByCode = new Map((rules ?? []).map((r: any) => [r.code, r.last_triggered_at]));
    return REQUIRED.map((r) => ({
      ...r,
      present: have.has(r.code),
      last_triggered_at: lastByCode.get(r.code) ?? null,
    }));
  });
