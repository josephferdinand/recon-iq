/**
 * Roadmap audit-ready criteria — per-item, six dimensions. The DB trigger
 * tg_roadmap_audit_ready_sync flips roadmap_items.audit_ready true only
 * when all rows satisfied=true for the item.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const CRITERIA = [
  "tests_pass",
  "docs_updated",
  "diagram_rendered",
  "evidence_pack",
  "security_scan_clean",
  "rls_coverage",
] as const;

export const listReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data: items, error: e1 } = await context.supabase
      .from("roadmap_items")
      .select("id,title,wave,priority,status,readiness,audit_ready,owner_label,tags");
    if (e1) throw new Error(e1.message);
    const { data: criteria, error: e2 } = await context.supabase
      .from("roadmap_readiness_criteria" as any)
      .select("roadmap_item_id,criterion,satisfied,evidence_url,satisfied_at");
    if (e2) throw new Error(e2.message);
    const byItem = new Map<string, any[]>();
    for (const c of (criteria ?? []) as any[]) {
      const arr = byItem.get(c.roadmap_item_id) ?? [];
      arr.push(c);
      byItem.set(c.roadmap_item_id, arr);
    }
    return (items ?? []).map((it) => ({
      ...it,
      criteria: byItem.get(it.id) ?? [],
    }));
  });

export const setCriterion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      roadmap_item_id: z.string().uuid(),
      criterion: z.enum(CRITERIA),
      satisfied: z.boolean(),
      evidence_url: z.string().max(2000).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("roadmap_readiness_criteria" as any)
      .upsert({
        roadmap_item_id: data.roadmap_item_id,
        criterion: data.criterion,
        satisfied: data.satisfied,
        evidence_url: data.evidence_url ?? null,
        satisfied_at: data.satisfied ? new Date().toISOString() : null,
        satisfied_by: data.satisfied ? context.userId : null,
      } as any, { onConflict: "roadmap_item_id,criterion" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
