// ─────────────────────────────────────────────────────────────────────────────
// Tenant Administration — Batch 2 follow-up server functions
//   Closes the three follow-ups called out in docs/TENANT_ADMIN_GAP_CLOSURE.md:
//     1) Conditional-access evaluator wired into the login flow
//     2) Auto-rotate scan for secret_rotation_policies (advisory + notify)
//     3) CSV/JSON renderer for tenant_report_definitions
// ─────────────────────────────────────────────────────────────────────────────
import { createServerFn } from "@tanstack/react-start";
import { getRequest, getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { runtimeReportFormat } from "@/lib/report-export-formats";

// ═════════════════════════════ Conditional Access ════════════════════════════
// Evaluates the tenant's ordered conditional_access_rules against the current
// request context. Returns the first matching rule's action ("allow" | "block"
// | "step_up") or a default "allow" when no rule matches.
//
// Supported `conditions` keys (all optional, additive AND semantics):
//   - ip_cidrs:        string[] of CIDR blocks; matches when the caller IP is in any
//   - blocked_countries: string[] of ISO country codes; matches when country in list
//   - allowed_countries: string[]; matches when country NOT in list
//   - time_windows:    Array<{ start:"HH:MM", end:"HH:MM", tz?:"UTC" }>
//   - user_agent_deny: string[]; substring match against UA header
//   - require_mfa:     boolean; matches when session claims lack `amr:"mfa"`
// ─────────────────────────────────────────────────────────────────────────────

function ipInCidr(ip: string, cidr: string): boolean {
  try {
    const [range, bitsStr] = cidr.split("/");
    const bits = Number(bitsStr ?? "32");
    if (!range || !Number.isFinite(bits)) return false;
    const toLong = (s: string) =>
      s.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (toLong(ip) & mask) === (toLong(range) & mask);
  } catch {
    return false;
  }
}

function inTimeWindow(now: Date, w: { start: string; end: string }): boolean {
  const [sh, sm] = w.start.split(":").map(Number);
  const [eh, em] = w.end.split(":").map(Number);
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const s = (sh ?? 0) * 60 + (sm ?? 0);
  const e = (eh ?? 23) * 60 + (em ?? 59);
  return s <= e ? mins >= s && mins <= e : mins >= s || mins <= e;
}

type EvalContext = {
  ip: string;
  countryCode: string | null;
  userAgent: string;
  hasMfa: boolean;
};

function ruleMatches(cond: Record<string, unknown>, ctx: EvalContext): boolean {
  const cidrs = cond.ip_cidrs as string[] | undefined;
  if (cidrs?.length && !cidrs.some((c) => ipInCidr(ctx.ip, c))) return false;

  const blocked = cond.blocked_countries as string[] | undefined;
  if (blocked?.length && ctx.countryCode && blocked.includes(ctx.countryCode)) return true;
  if (blocked?.length && !ctx.countryCode) return false;

  const allowed = cond.allowed_countries as string[] | undefined;
  if (allowed?.length && ctx.countryCode && !allowed.includes(ctx.countryCode)) return true;

  const windows = cond.time_windows as Array<{ start: string; end: string }> | undefined;
  if (windows?.length) {
    const now = new Date();
    if (!windows.some((w) => inTimeWindow(now, w))) return true;
  }

  const uaDeny = cond.user_agent_deny as string[] | undefined;
  if (uaDeny?.length && uaDeny.some((s) => ctx.userAgent.toLowerCase().includes(s.toLowerCase()))) {
    return true;
  }

  if (cond.require_mfa === true && !ctx.hasMfa) return true;

  // Only ip_cidrs matched (whitelist form) → treat as match=false = allow
  return !!(cidrs?.length && cidrs.some((c) => ipInCidr(ctx.ip, c)));
}

export const evaluateConditionalAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) =>
    z.object({
      tenantId: z.string().uuid().optional().nullable(),
      loginAttemptId: z.string().uuid().optional(),
      hints: z
        .object({ country: z.string().max(4).optional(), ip: z.string().max(64).optional() })
        .optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    // No tenant → no evaluation (root/home landing has no tenant scope).
    if (!data.tenantId) return { action: "allow" as const, matched: null };

    const req = getRequest();
    const ip =
      data.hints?.ip ??
      getRequestHeader("cf-connecting-ip") ??
      getRequestHeader("x-real-ip") ??
      getRequestIP({ xForwardedFor: true }) ??
      "0.0.0.0";
    const country =
      data.hints?.country ?? getRequestHeader("cf-ipcountry") ?? getRequestHeader("x-country") ?? null;
    const userAgent = req?.headers.get("user-agent") ?? "";
    const amr = (context.claims as any)?.amr;
    const hasMfa = Array.isArray(amr) && amr.some((m: any) => String(m).toLowerCase().includes("mfa"));

    const { data: rules, error } = await context.supabase
      .from("conditional_access_rules")
      .select("*")
      .eq("tenant_id", data.tenantId)
      .eq("is_enabled", true)
      .order("priority", { ascending: true });
    if (error) throw error;

    const ctx: EvalContext = { ip, countryCode: country, userAgent, hasMfa };
    for (const r of rules ?? []) {
      const cond = (r.conditions ?? {}) as Record<string, unknown>;
      if (ruleMatches(cond, ctx)) {
        // Best-effort audit
        try {
          await context.supabase.from("security_events" as never).insert({
            event_type: "conditional_access.match",
            severity: r.action === "block" ? "critical" : "warning",
            user_id: context.userId,
            context: { tenantId: data.tenantId, ruleId: r.id, action: r.action, ip, country },
          } as never);
        } catch {
          /* swallow */
        }
        // A login alert uses only the authenticated actor and a real current
        // block. Hint-based admin evaluations retain their old behavior and
        // cannot authorize a sign-in email from caller-supplied context.
        if (r.action === "block" && data.loginAttemptId && !data.hints) {
          try {
            const { notifyVerifiedLoginPolicyBlock } = await import("./failed-login-auth.server");
            await notifyVerifiedLoginPolicyBlock(data.loginAttemptId, context.userId, req);
          } catch {
            console.error("[failed-login]", { code: "notification_record_unavailable", attemptId: data.loginAttemptId });
          }
        }
        return {
          action: (r.action as "allow" | "block" | "step_up") ?? "allow",
          matched: { id: r.id, name: r.name, action: r.action, priority: r.priority },
        };
      }
    }
    return { action: "allow" as const, matched: null };
  });

// ══════════════════════════════ Rotation Scan ════════════════════════════════
// Reconciles secret_rotation_policies against actual app_vault_secret_versions
// activity. Reschedules `next_rotation_at` from the latest observed rotation and
// creates advisory notifications for tenant admins when overdue.
// ─────────────────────────────────────────────────────────────────────────────
export const runRotationScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({ tenantId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("secret_rotation_policies")
      .select("*")
      .eq("tenant_id", data.tenantId)
      .eq("is_active", true);
    if (error) throw error;

    const now = Date.now();
    let overdue = 0;
    let rescheduled = 0;
    for (const p of rows ?? []) {
      const dueAt = p.next_rotation_at ? new Date(p.next_rotation_at).getTime() : now;
      const intervalMs = (p.rotation_interval_days ?? 90) * 86_400_000;

      // Detect an actual rotation on the linked secret (latest version created_at).
      let latestRotationAt: number | null = null;
      if (p.secret_id) {
        const { data: ver } = await context.supabase
          .from("app_vault_secret_versions")
          .select("created_at,version")
          .eq("secret_id", p.secret_id)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (ver?.created_at) latestRotationAt = new Date(ver.created_at).getTime();
      }

      if (latestRotationAt && (!p.last_rotation_at || latestRotationAt > new Date(p.last_rotation_at).getTime())) {
        await context.supabase
          .from("secret_rotation_policies")
          .update({
            last_rotation_at: new Date(latestRotationAt).toISOString(),
            next_rotation_at: new Date(latestRotationAt + intervalMs).toISOString(),
          })
          .eq("id", p.id);
        rescheduled += 1;
        continue;
      }

      if (dueAt <= now) {
        overdue += 1;
        // Fan out advisory notification to tenant admins.
        const { data: admins } = await context.supabase
          .from("tenant_members")
          .select("user_id,role")
          .eq("tenant_id", data.tenantId)
          .in("role", ["tenant_admin"]);
        for (const a of admins ?? []) {
          await context.supabase.from("notifications").insert({
            user_id: a.user_id,
            tenant_id: data.tenantId,
            kind: "secret.rotation.overdue",
            severity: "warning",
            title: "Secret rotation overdue",
            body: `Rotation policy "${p.category ?? p.provider ?? "secret"}" is past its due date. Auto-rotate=${p.auto_rotate}.`,
            context: { policy_id: p.id, secret_id: p.secret_id, due_at: p.next_rotation_at },
          } as never);
        }
      }
    }
    return { ok: true, scanned: rows?.length ?? 0, overdue, rescheduled };
  });

// ══════════════════════════════ Report Renderer ══════════════════════════════
// Runs a report definition against the tenant's data. The Worker supports CSV
// and JSON only. Legacy PDF/XLSX definitions are truthfully normalized to CSV.
// ─────────────────────────────────────────────────────────────────────────────
function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "";
  const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

export const renderReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: def, error } = await context.supabase
      .from("tenant_report_definitions")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error) throw error;

    const supa = context.supabase;
    let rows: Array<Record<string, unknown>> = [];
    let title = def.name;

    switch (def.category) {
      case "security": {
        const { data: r } = await supa
          .from("security_events")
          .select("event_type,severity,created_at,user_id,context")
          .order("created_at", { ascending: false })
          .limit(1000);
        rows = (r ?? []) as any;
        break;
      }
      case "ai": {
        const { data: r } = await supa
          .from("ai_usage_events")
          .select("provider,model,tokens_in,tokens_out,cost_usd,created_at")
          .eq("tenant_id", def.tenant_id)
          .order("created_at", { ascending: false })
          .limit(1000);
        rows = (r ?? []) as any;
        break;
      }
      case "users": {
        const { data: r } = await supa
          .from("tenant_members")
          .select("user_id,role,invited_at,joined_at,status")
          .eq("tenant_id", def.tenant_id);
        rows = (r ?? []) as any;
        break;
      }
      case "compliance": {
        const { data: r } = await supa
          .from("tenant_policy_compliance")
          .select("*")
          .eq("tenant_id", def.tenant_id);
        rows = (r ?? []) as any;
        break;
      }
      case "usage": {
        const { data: r } = await supa
          .from("platform_tenant_usage_kpis")
          .select("*")
          .eq("tenant_id", def.tenant_id)
          .order("captured_at", { ascending: false })
          .limit(500);
        rows = (r ?? []) as any;
        break;
      }
      case "cost": {
        const { data: r } = await supa
          .from("ai_usage_events")
          .select("model,cost_usd,created_at")
          .eq("tenant_id", def.tenant_id)
          .order("created_at", { ascending: false })
          .limit(1000);
        rows = (r ?? []) as any;
        break;
      }
      default: {
        rows = [{ note: "Custom report — no default query bound", spec: JSON.stringify(def.query_spec ?? {}) }];
      }
    }

    const csv = toCsv(rows);
    const format = runtimeReportFormat(def.format);
    const body = format === "json" ? JSON.stringify({ title, rows }, null, 2) : csv;
    const mime = format === "json" ? "application/json" : "text/csv";
    const ext = format === "json" ? "json" : "csv";
    const filename = `${def.name.replace(/[^a-z0-9]+/gi, "_")}_${new Date().toISOString().slice(0, 10)}.${ext}`;

    await supa
      .from("tenant_report_definitions")
      .update({ last_run_at: new Date().toISOString() })
      .eq("id", def.id);

    return { filename, mime, body, rows: rows.length };
  });
