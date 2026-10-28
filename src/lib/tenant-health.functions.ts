import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Tenant Health Score — Sprint 3 Feature 1.
 *
 * `getTenantHealthScore(tenant_id)` — returns the latest snapshot from
 * `tenant_health_scores` for the tenant. RLS-scoped to the caller's tenant.
 *
 * `computeTenantHealthScore(tenant_id)` — forces a recompute via the
 * `compute_tenant_health_score(tenant_id)` SQL function. service_role scoped;
 * may be called by cron or by a user with platform-admin role.
 *
 * `getTenantHealthTrend(tenant_id, days)` — 30-day per-day sparkline.
 */

const TenantIdSchema = z.object({ tenant_id: z.string().uuid() });

export type TenantHealthScore = {
  id: string;
  tenant_id: string;
  computed_at: string;
  window_days: number;
  overall_score: number;
  match_quality_score: number;
  exception_volume_score: number;
  time_to_resolve_score: number;
  rule_coverage_score: number;
  ai_confidence_score: number;
  runs_analyzed: number;
  exceptions_open: number;
  exceptions_resolved_30d: number;
  rules_total: number;
  rules_active: number;
  avg_match_rate: number;
  median_ttr_hours: number;
  trend: number[];
  top_issues: Array<{ severity: string; category: string; message: string }>;
};

export const getTenantHealthScore = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) => TenantIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .rpc("get_latest_tenant_health", { _tenant_id: data.tenant_id })
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (row ?? null) as TenantHealthScore | null;
  });

export const getTenantHealthTrend = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; days?: number }) =>
    z.object({ tenant_id: z.string().uuid(), days: z.number().int().min(7).max(90).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("get_tenant_health_trend", {
      _tenant_id: data.tenant_id,
      _days: data.days ?? 30,
    });
    if (error) throw new Error(error.message);
    return ((rows ?? []) as Array<{ day: string; overall_score: number }>).map((r) => ({
      day: r.day,
      overall_score: Number(r.overall_score ?? 0),
    }));
  });

/**
 * Forces a fresh score recomputation. The caller MUST be either a platform
 * admin OR a tenant admin. We deliberately do NOT use service_role from a
 * user-facing mutation — this keeps the 4-layer tenant isolation (D-009)
 * intact while still letting users refresh their own dashboards.
 */
export const refreshTenantHealthScore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) => TenantIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    // Authorization: caller is platform admin OR tenant admin
    const { data: isAdmin } = await context.supabase.rpc("is_platform_admin", {
      _user_id: context.userId,
    });
    if (!isAdmin) {
      const { data: memberRow, error: memberErr } = await context.supabase
        .from("tenant_members")
        .select("role")
        .eq("tenant_id", data.tenant_id)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (memberErr) throw new Error(memberErr.message);
      const role = (memberRow as { role?: string } | null)?.role ?? "";
      if (role !== "owner" && role !== "tenant_admin") {
        throw new Error("Forbidden: platform or tenant admin required");
      }
    }

    const { data: row, error } = await supabaseAdmin.rpc("compute_tenant_health_score", {
      _tenant_id: data.tenant_id,
      _window_days: 30,
    });
    if (error) throw new Error(error.message);
    return (row as unknown as TenantHealthScore | null) ?? null;
  });
