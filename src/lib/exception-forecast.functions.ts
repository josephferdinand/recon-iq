import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Exception Forecast — Sprint 3 Feature 2.
 *
 * `getExceptionForecast(tenant_id)` — latest forecast snapshot.
 * `predictExceptionVolume(tenant_id, horizon_days)` — force a fresh
 *   heuristic recompute (service_role under the hood; the caller must be
 *   tenant admin or platform admin).
 */

const ForecastInputSchema = z.object({
  tenant_id: z.string().uuid(),
  horizon_days: z.number().int().min(1).max(30).optional(),
});

export type ExceptionForecast = {
  id: string;
  tenant_id: string;
  computed_at: string;
  horizon_days: number;
  expected_count: number;
  lower_count: number;
  upper_count: number;
  baseline_daily_mean: number;
  baseline_daily_stddev: number;
  rolling_median_30d: number;
  anomaly_factor: number;
  is_anomaly_active: boolean;
  per_day: Array<{
    date: string;
    expected: number;
    lower: number;
    upper: number;
    dow_factor: number;
  }>;
  history: Array<{ date: string; count: number }>;
};

export const getExceptionForecast = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; horizon_days?: number }) => ForecastInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .rpc("get_latest_exception_forecast", { _tenant_id: data.tenant_id })
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (row ?? null) as ExceptionForecast | null;
  });

export const predictExceptionVolume = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; horizon_days?: number }) =>
    ForecastInputSchema.parse(d))
  .handler(async ({ data, context }) => {
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

    const { data: row, error } = await supabaseAdmin.rpc("predict_next_exception_volume", {
      _tenant_id: data.tenant_id,
      _horizon_days: data.horizon_days ?? 7,
      _as_of: new Date().toISOString().slice(0, 10),
    });
    if (error) throw new Error(error.message);
    return (row as unknown as ExceptionForecast | null) ?? null;
  });
