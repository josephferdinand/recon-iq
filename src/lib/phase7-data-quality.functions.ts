// Phase 7 — Data Quality engine
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listDqRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: z.string().uuid(), enabledOnly: z.boolean().default(false) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("dq_rules").select("*").eq("tenant_id", data.tenant_id);
    if (data.enabledOnly) q = q.eq("enabled", true);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertDqRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      tenant_id: z.string().uuid(),
      name: z.string().min(1),
      description: z.string().optional(),
      target_schema: z.string().default("public"),
      target_table: z.string().min(1),
      expression: z.string().min(1),
      severity: z.enum(["low","medium","high","critical"]).default("medium"),
      enabled: z.boolean().default(true),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("dq_rules").upsert(data as never, { onConflict: "id" }).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const recordDqResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      dq_rule_id: z.string().uuid(),
      score: z.number().min(0).max(1),
      violations: z.number().int().min(0),
      samples: z.array(z.record(z.string(), z.unknown())).max(50).default([]),
      severity: z.enum(["low","medium","high","critical"]).default("medium"),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("dq_results").insert(data as never).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listDqResults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      limit: z.number().int().min(1).max(500).default(100),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("dq_results")
      .select("id,dq_rule_id,run_at,score,violations,severity")
      .eq("tenant_id", data.tenant_id)
      .order("run_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
