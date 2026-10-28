import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Wave = z.enum(["current", "next", "future", "shipped"]);
const Priority = z.enum(["P0", "P1", "P2", "P3"]);
const Scope = z.enum(["platform", "tenant", "workspace", "ai", "security", "compliance", "integration"]);
const Status = z.enum(["planned", "in_progress", "blocked", "review", "shipped", "deferred"]);

export const listRoadmap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ wave: Wave.optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("roadmap_items")
      .select("id,title,summary,wave,priority,scope,owner_user_id,owner_label,status,readiness,audit_ready,target_date,links,tags,updated_at");
    if (data.wave) q = q.eq("wave", data.wave);
    const { data: rows, error } = await q.order("priority").order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertRoadmap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    id: z.string().uuid().optional(),
    title: z.string().min(2).max(200),
    summary: z.string().max(2000).optional().nullable(),
    wave: Wave.default("next"),
    priority: Priority.default("P1"),
    scope: Scope.default("platform"),
    owner_label: z.string().max(120).optional().nullable(),
    status: Status.default("planned"),
    readiness: z.number().int().min(0).max(100).default(0),
    audit_ready: z.boolean().default(false),
    target_date: z.string().optional().nullable(),
    tags: z.array(z.string().min(1).max(40)).default([]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const payload: any = { ...data, created_by: context.userId };
    if (!data.id) delete payload.id;
    const { data: row, error } = await context.supabase.from("roadmap_items").upsert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteRoadmap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("roadmap_items").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const roadmapSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data: rows, error } = await context.supabase.from("roadmap_items")
      .select("wave,priority,status,readiness,audit_ready");
    if (error) throw new Error(error.message);
    const items = rows ?? [];
    const byWave: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let auditReady = 0;
    let readinessSum = 0;
    for (const r of items) {
      byWave[r.wave] = (byWave[r.wave] ?? 0) + 1;
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      if (r.audit_ready) auditReady++;
      readinessSum += r.readiness ?? 0;
    }
    return {
      total: items.length,
      avg_readiness: items.length ? Math.round(readinessSum / items.length) : 0,
      audit_ready: auditReady,
      by_wave: byWave,
      by_status: byStatus,
    };
  });
