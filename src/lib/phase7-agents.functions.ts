// Phase 7 — Agent runbooks + agent execution facades
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listAgentRunbooks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ applies_to: z.string().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("agent_runbooks").select("*").order("code");
    if (data.applies_to) q = q.eq("applies_to", data.applies_to);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const startRuleOptimisationRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      recon_definition_id: z.string().uuid().optional(),
      baseline_run_id: z.string().uuid().optional(),
      candidates: z.array(z.record(z.string(), z.unknown())).default([]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("rule_optimisation_runs").insert({ ...data, status: "queued" } as never).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listRuleOptimisationRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: z.string().uuid(), limit: z.number().int().min(1).max(200).default(50) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("rule_optimisation_runs")
      .select("*")
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
