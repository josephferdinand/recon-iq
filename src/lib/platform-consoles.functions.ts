/**
 * Server functions powering the Tenant detail dossier and the consolidated
 * Ops Console. Both are platform-admin only.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/rbac-guards.server";
import { z } from "zod";

async function assertPlatformAdmin(ctx: any) {
  await requirePlatformAdmin(ctx, { fnName: "platform-consoles" });
}

/* ------------------------------------------------------------------ */
/* Tenant detail dossier                                              */
/* ------------------------------------------------------------------ */

export const getTenantDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const sb = context.supabase;
    const tid = data.tenant_id;

    const [tenant, members, audit, bgGrants, flags, ipAllow, connectors, retention] =
      await Promise.all([
        sb.from("tenants").select("*, family:tenant_families(id,name)").eq("id", tid).maybeSingle(),
        sb.from("tenant_members")
          .select("user_id, role, added_by_platform, invited_by, created_at, profile:profiles(email, full_name)")
          .eq("tenant_id", tid).order("created_at", { ascending: false }).limit(200),
        sb.from("audit_log")
          .select("id, occurred_at, actor_email, scope, action, resource_type")
          .eq("tenant_id", tid).order("occurred_at", { ascending: false }).limit(25),
        sb.from("break_glass_grants" as any)
          .select("id, scope, status, requested_at, expires_at, requested_by, justification")
          .eq("tenant_id", tid).order("requested_at", { ascending: false }).limit(10),
        sb.from("tenant_feature_flags")
          .select("feature_key, enabled, updated_at")
          .eq("tenant_id", tid).order("feature_key", { ascending: true }),
        sb.from("tenant_ip_allowlist")
          .select("cidr, description, created_at")
          .eq("tenant_id", tid).limit(50),
        sb.from("erp_connector_configs")
          .select("id, name, kind, status, updated_at")
          .eq("tenant_id", tid).limit(50),
        (sb.from("retention_policies" as any) as any)
          .select("table_name, retention_days, updated_at")
          .eq("tenant_id", tid),
      ]);

    if (tenant.error) throw new Error(tenant.error.message);
    if (!tenant.data) throw new Error("Tenant not found");

    return {
      tenant: tenant.data,
      members: members.data ?? [],
      audit: audit.data ?? [],
      break_glass: bgGrants.data ?? [],
      feature_flags: flags.data ?? [],
      ip_allowlist: ipAllow.data ?? [],
      connectors: connectors.data ?? [],
      retention: retention.data ?? [],
    };
  });

/* ------------------------------------------------------------------ */
/* Ops console — aggregated SRE cockpit KPIs                          */
/* ------------------------------------------------------------------ */

export const getOpsConsoleMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const sb = context.supabase;
    const now = new Date();
    const since24h = new Date(now.getTime() - 24 * 3600_000).toISOString();
    const since7d = new Date(now.getTime() - 7 * 86_400_000).toISOString();

    const [
      workers,
      breakers,
      chaosOpen,
      drDrills,
      alertsOpen,
      hitlPending,
      loginAnoms,
      killSwitches,
      backupsFailed,
      slaBreach,
    ] = await Promise.all([
      sb.from("worker_health_heartbeats")
        .select("worker_kind, status, last_heartbeat_at").limit(500),
      sb.from("worker_circuit_breakers")
        .select("worker_kind, state, opened_at").limit(200),
      sb.from("chaos_drills")
        .select("id, name, status, scheduled_for")
        .in("status", ["scheduled", "running"] as any).limit(50),
      sb.from("dr_drills")
        .select("id, region, status, started_at")
        .gte("started_at", since7d).limit(50),
      sb.from("security_alert_incidents")
        .select("id, severity, fired_at, rule_id, acknowledged_at")
        .is("acknowledged_at", null).order("fired_at", { ascending: false }).limit(50),
      sb.from("ai_governance_hitl_queue")
        .select("id, status, created_at").eq("status", "pending").limit(200),
      sb.from("login_anomaly_events")
        .select("id, kind, occurred_at").gte("occurred_at", since24h).limit(200),
      sb.from("ai_governance_kill_switches")
        .select("id, name, engaged, engaged_at").eq("engaged", true).limit(50),
      sb.from("platform_backup_events")
        .select("id, event_type, created_at").ilike("event_type", "%fail%").gte("created_at", since7d).limit(50),
      sb.from("break_sla_events")
        .select("id, event_type, occurred_at").eq("event_type", "breached").gte("occurred_at", since24h).limit(200),
    ]);

    const workerRows = workers.data ?? [];
    const workerDegraded = workerRows.filter(
      (w: any) => w.status !== "healthy" && w.status !== "ok",
    ).length;
    const breakerRows = breakers.data ?? [];
    const openBreakers = breakerRows.filter((b: any) => b.state === "open").length;

    return {
      generated_at: now.toISOString(),
      cards: [
        {
          key: "workers",
          label: "Workers",
          value: `${workerRows.length - workerDegraded}/${workerRows.length}`,
          detail: `${workerDegraded} degraded · ${openBreakers} breakers open`,
          tone: workerDegraded === 0 && openBreakers === 0 ? "ok" : workerDegraded > 5 ? "critical" : "warn",
        },
        {
          key: "chaos",
          label: "Chaos drills",
          value: String((chaosOpen.data ?? []).length),
          detail: "Scheduled or running",
          tone: "info",
        },
        {
          key: "dr",
          label: "DR drills (7d)",
          value: String((drDrills.data ?? []).length),
          detail: "Failover exercises",
          tone: "info",
        },
        {
          key: "alerts",
          label: "Open security alerts",
          value: String((alertsOpen.data ?? []).length),
          detail: `Highest: ${((alertsOpen.data ?? []) as any[])[0]?.severity ?? "—"}`,
          tone: (alertsOpen.data ?? []).length === 0 ? "ok" : "critical",
        },
        {
          key: "hitl",
          label: "HITL queue",
          value: String((hitlPending.data ?? []).length),
          detail: "Pending AI reviews",
          tone: (hitlPending.data ?? []).length > 20 ? "warn" : "info",
        },
        {
          key: "login",
          label: "Login anomalies (24h)",
          value: String((loginAnoms.data ?? []).length),
          detail: "Impossible-travel / new device",
          tone: (loginAnoms.data ?? []).length > 10 ? "warn" : "info",
        },
        {
          key: "kill",
          label: "Kill switches engaged",
          value: String((killSwitches.data ?? []).length),
          detail: "AI capability halts",
          tone: (killSwitches.data ?? []).length === 0 ? "ok" : "critical",
        },
        {
          key: "backups",
          label: "Backup failures (7d)",
          value: String((backupsFailed.data ?? []).length),
          detail: "Platform backup events",
          tone: (backupsFailed.data ?? []).length === 0 ? "ok" : "warn",
        },
        {
          key: "sla",
          label: "SLA breaches (24h)",
          value: String((slaBreach.data ?? []).length),
          detail: "Break resolution SLA",
          tone: (slaBreach.data ?? []).length === 0 ? "ok" : "warn",
        },
      ],
      workers_by_kind: Object.entries(
        workerRows.reduce((acc: any, w: any) => {
          const k = w.worker_kind ?? "unknown";
          acc[k] = acc[k] ?? { total: 0, healthy: 0 };
          acc[k].total++;
          if (w.status === "healthy" || w.status === "ok") acc[k].healthy++;
          return acc;
        }, {}),
      ).map(([kind, v]: any) => ({ kind, ...v })),
      open_alerts_recent: (alertsOpen.data ?? []).slice(0, 10),
      chaos_upcoming: chaosOpen.data ?? [],
    };
  });

/* ------------------------------------------------------------------ */
/* SOC2 monitor — live status of each control                         */
/* ------------------------------------------------------------------ */

export const getSoc2Monitor = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const sb = context.supabase;
    const since30d = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [controls, runs] = await Promise.all([
      sb.from("soc2_controls")
        .select("id, control_code, tsc, title, owner")
        .order("control_code", { ascending: true }),
      sb.from("soc2_evidence_runs")
        .select("control_id, status, run_date, collected_at, notes")
        .gte("run_date", since30d)
        .order("collected_at", { ascending: false })
        .limit(2000),
    ]);
    if (controls.error) throw new Error(controls.error.message);
    const byControl = new Map<string, any>();
    for (const r of runs.data ?? []) {
      if (!byControl.has(r.control_id)) byControl.set(r.control_id, r);
    }
    const rows = (controls.data ?? []).map((c: any) => {
      const latest = byControl.get(c.id);
      return {
        control_code: c.control_code,
        tsc: c.tsc,
        title: c.title,
        owner: c.owner,
        latest_status: latest?.status ?? "no-run",
        latest_at: latest?.collected_at ?? null,
        notes: latest?.notes ?? null,
      };
    });
    const summary = rows.reduce(
      (acc: any, r) => {
        const k = r.latest_status;
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      },
      { pass: 0, fail: 0, warn: 0, "no-run": 0 } as Record<string, number>,
    );
    return { rows, summary, generated_at: new Date().toISOString() };
  });

/* ------------------------------------------------------------------ */
/* Session anomalies drill-down                                       */
/* ------------------------------------------------------------------ */

export const listSessionAnomalies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      hours: z.number().int().min(1).max(720).default(72),
      severity: z.enum(["all", "low", "medium", "high", "critical"]).default("all"),
      unresolved_only: z.boolean().default(false),
      limit: z.number().int().min(1).max(500).default(200),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const since = new Date(Date.now() - data.hours * 3600_000).toISOString();
    let q = context.supabase
      .from("login_anomaly_events")
      .select("id, user_id, tenant_id, event_type, severity, ip_address, user_agent, geo_country, details, resolved_at, resolved_by, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.severity !== "all") q = q.eq("severity", data.severity);
    if (data.unresolved_only) q = q.is("resolved_at", null);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const events = (rows ?? []).map((r: any) => ({
      ...r,
      ip_address: r.ip_address == null ? null : String(r.ip_address),
    }));
    const bySev = events.reduce((acc: any, r: any) => {
      acc[r.severity ?? "unknown"] = (acc[r.severity ?? "unknown"] ?? 0) + 1;
      return acc;
    }, {});
    return { events, summary: bySev };
  });

export const resolveSessionAnomaly = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { error } = await context.supabase
      .from("login_anomaly_events")
      .update({ resolved_at: new Date().toISOString(), resolved_by: context.userId } as any)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* RBAC diagnostics — explain a user's effective permissions          */
/* ------------------------------------------------------------------ */

export const diagnoseUserAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      email: z.string().email().optional(),
      user_id: z.string().uuid().optional(),
      tenant_id: z.string().uuid().optional(),
    }).refine((v) => v.email || v.user_id, "email or user_id required")
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const sb = context.supabase;

    // Resolve subject
    let profile: any = null;
    if (data.user_id) {
      const { data: p } = await sb.from("profiles")
        .select("id, email, full_name").eq("id", data.user_id).maybeSingle();
      profile = p;
    } else if (data.email) {
      const { data: p } = await sb.from("profiles")
        .select("id, email, full_name").ilike("email", data.email).maybeSingle();
      profile = p;
    }
    if (!profile) throw new Error("User not found");

    const [platRoles, tenantMemberships, grants] = await Promise.all([
      sb.from("platform_roles").select("role").eq("user_id", profile.id),
      sb.from("tenant_members")
        .select("tenant_id, role, tenant:tenants(id, name, slug, environment)")
        .eq("user_id", profile.id),
      sb.from("rbac_user_grants")
        .select("tenant_id, role_id, scope_type, scope_id, role:rbac_roles(key, name, is_system)")
        .eq("user_id", profile.id)
        .limit(500),
    ]);

    // Effective permissions for the requested (or all) tenant scopes via role permissions
    const roleIds = Array.from(
      new Set((grants.data ?? []).map((g: any) => g.role_id).filter(Boolean)),
    );
    let permissions: any[] = [];
    if (roleIds.length > 0) {
      const { data: rp } = await sb.from("rbac_role_permissions")
        .select("role_id, permission_id, permission:permissions(id, resource, action, category, is_dangerous, requires_step_up)")
        .in("role_id", roleIds);
      permissions = rp ?? [];
    }

    // Deduplicate by permission_id, mark source roles
    const permMap = new Map<string, any>();
    for (const row of permissions as any[]) {
      const pid = row.permission_id;
      const entry = permMap.get(pid) ?? { permission: row.permission, via_roles: [] as string[] };
      const grant = (grants.data ?? []).find((g: any) => g.role_id === row.role_id);
      const roleKey = grant?.role?.key ?? row.role_id;
      if (!entry.via_roles.includes(roleKey)) entry.via_roles.push(roleKey);
      permMap.set(pid, entry);
    }
    const effective = Array.from(permMap.values()).sort((a: any, b: any) => {
      const ka = `${a.permission?.resource}.${a.permission?.action}`;
      const kb = `${b.permission?.resource}.${b.permission?.action}`;
      return ka.localeCompare(kb);
    });

    return {
      subject: profile,
      platform_roles: (platRoles.data ?? []).map((r: any) => r.role),
      tenant_memberships: tenantMemberships.data ?? [],
      grants: grants.data ?? [],
      effective_permissions: effective,
    };
  });
