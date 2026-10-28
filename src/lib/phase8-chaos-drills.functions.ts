/**
 * Phase 8 — Chaos drills server fns.
 *
 * Catalog of named drills, scheduled drill rows, and append-only findings.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listChaosCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({}).parse(d))
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("chaos_drill_catalog")
      .select("code,name,description,category,enabled")
      .eq("enabled", true)
      .order("category").order("code");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const scheduleChaosDrill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid().nullable().optional(),
      drill_code: z.string().min(2),
      scheduled_for: z.string().datetime(),
      summary: z.string().max(2000).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload = { ...data, status: "scheduled", created_by: context.userId };
    const { data: row, error } = await context.supabase
      .from("chaos_drills")
      .insert(payload as never)
      .select("id,drill_code,scheduled_for,status")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const recordDrillResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["passed","failed","cancelled"]),
      rto_seconds: z.number().int().nonnegative().optional(),
      rpo_seconds: z.number().int().nonnegative().optional(),
      summary: z.string().max(4000).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("chaos_drills")
      .update({
        status: data.status,
        rto_seconds: data.rto_seconds ?? null,
        rpo_seconds: data.rpo_seconds ?? null,
        summary: data.summary ?? null,
        ended_at: new Date().toISOString(),
      } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listChaosDrills = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid().nullable().optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("chaos_drills")
      .select("id,drill_code,scheduled_for,started_at,ended_at,status,rto_seconds,rpo_seconds,summary,tenant_id");
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    const { data: rows, error } = await q.order("scheduled_for", { ascending: false }).limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const addDrillFinding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      drill_id: z.string().uuid(),
      tenant_id: z.string().uuid().nullable().optional(),
      severity: z.enum(["info","low","medium","high","critical"]),
      title: z.string().min(1).max(200),
      detail: z.string().max(4000).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("chaos_drill_findings")
      .insert(data as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Pure helper — drill cadence checker for the quarterly programme.
 * Returns the next quarter due-by date given the most recent drill.
 */
export function nextQuarterlyDrillDate(lastDrillIso: string | null, now: Date = new Date()): string {
  if (!lastDrillIso) {
    const d = new Date(now);
    d.setUTCMonth(d.getUTCMonth() + 3);
    return d.toISOString();
  }
  const candidate = new Date(lastDrillIso);
  candidate.setUTCMonth(candidate.getUTCMonth() + 3);
  if (candidate <= now) {
    const d = new Date(now);
    d.setUTCMonth(d.getUTCMonth() + 3);
    return d.toISOString();
  }
  return candidate.toISOString();
}
