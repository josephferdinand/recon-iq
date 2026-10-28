import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const WindowEnum = z.union([z.literal(7), z.literal(30), z.literal(90)]);

export type AnalyticsTotals = {
  total: number;
  active: number;
  inactive: number;
  never_signed_in: number;
  mfa_enrolled: number;
  sso_users: number;
};

export type TrendPoint = { day: string; signins: number };
export type RoleRow = { role: string; count: number };
export type GroupRow = { group_id: string; name: string; count: number };
export type PerTenantRow = {
  tenant_id: string;
  name: string;
  slug: string | null;
  total_users: number;
  active_users: number;
  never_signed_in: number;
  mfa_users: number;
  sso_users: number;
};

export type TenantAnalytics = {
  tenant_id: string;
  window_days: number;
  totals: AnalyticsTotals;
  roles: RoleRow[];
  groups: GroupRow[];
  trend: TrendPoint[];
  generated_at: string;
};

export type PlatformAnalytics = {
  window_days: number;
  totals: AnalyticsTotals;
  per_tenant: PerTenantRow[];
  trend: TrendPoint[];
  generated_at: string;
};

const TenantInput = z.object({
  tenantId: z.string().uuid(),
  windowDays: WindowEnum.default(30),
});

export const getTenantUserAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => TenantInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rpc, error } = await context.supabase.rpc(
      "tenant_user_analytics",
      { _tenant: data.tenantId, _window_days: data.windowDays },
    );
    if (error) throw new Error(error.message);
    return rpc as TenantAnalytics;
  });

const PlatformInput = z.object({ windowDays: WindowEnum.default(30) });

export const getPlatformUserAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => PlatformInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rpc, error } = await context.supabase.rpc(
      "platform_user_analytics",
      { _window_days: data.windowDays },
    );
    if (error) throw new Error(error.message);
    return rpc as PlatformAnalytics;
  });
