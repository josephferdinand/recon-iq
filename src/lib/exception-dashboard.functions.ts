import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const exceptionDashboardInputSchema = z.object({
  tenant_id: z.string().uuid(),
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30),
});

const countByNameSchema = z.object({
  name: z.string(),
  count: z.number().int().nonnegative(),
});

const exceptionDashboardSchema = z.object({
  as_of: z.string().min(1),
  window_days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
  totals: z.object({
    total: z.number().int().nonnegative(),
    open: z.number().int().nonnegative(),
    resolved: z.number().int().nonnegative(),
    high_priority: z.number().int().nonnegative(),
    unassigned: z.number().int().nonnegative(),
    older_than_30_days: z.number().int().nonnegative(),
    oldest_open_days: z.number().int().nonnegative(),
  }),
  by_severity: z.array(countByNameSchema),
  by_status: z.array(countByNameSchema),
  ageing: z.array(countByNameSchema),
  trend: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
      created: z.number().int().nonnegative(),
      still_open: z.number().int().nonnegative(),
    }),
  ),
  by_reconciliation: z.array(
    z.object({
      id: z.string().uuid().nullable(),
      name: z.string(),
      open: z.number().int().nonnegative(),
      high_priority: z.number().int().nonnegative(),
      oldest_open_days: z.number().int().nonnegative(),
    }),
  ),
});

export type ExceptionDashboard = z.infer<typeof exceptionDashboardSchema>;

export const getExceptionDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => exceptionDashboardInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc(
      "get_exception_dashboard" as never,
      { _tenant_id: data.tenant_id, _days: data.days } as never,
    );
    if (error) throw new Error(error.message);
    return exceptionDashboardSchema.parse(result);
  });
