// Phase 7 — NAV / Fund Accounting + Shadow NAV
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listNavRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      fund_code: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(50),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("fund_nav_runs")
      .select("*")
      .eq("tenant_id", data.tenant_id)
      .order("nav_date", { ascending: false })
      .limit(data.limit);
    if (data.fund_code) q = q.eq("fund_code", data.fund_code);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const recordNavRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      fund_code: z.string().min(1),
      nav_date: z.string(),
      official_nav: z.number(),
      shadow_nav: z.number(),
      variance_bps_threshold: z.number().min(0).max(10_000).default(25),
      components: z.array(z.object({
        component: z.string(),
        official_value: z.number(),
        shadow_value: z.number(),
        notes: z.string().optional(),
      })).default([]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const bps = data.official_nav === 0
      ? 0
      : ((data.shadow_nav - data.official_nav) / data.official_nav) * 10_000;
    const status = Math.abs(bps) <= data.variance_bps_threshold ? "passed" : "breached";

    const { data: run, error } = await context.supabase
      .from("fund_nav_runs")
      .upsert({
        tenant_id: data.tenant_id,
        fund_code: data.fund_code,
        nav_date: data.nav_date,
        official_nav: data.official_nav,
        shadow_nav: data.shadow_nav,
        variance_bps: bps,
        status,
      } as never, { onConflict: "tenant_id,fund_code,nav_date" })
      .select()
      .single();
    if (error) throw new Error(error.message);

    if (data.components.length > 0) {
      await context.supabase.from("fund_nav_components").insert(
        data.components.map((c) => ({ ...c, run_id: run.id, tenant_id: data.tenant_id })),
      );
    }
    return { run, status, variance_bps: bps };
  });
