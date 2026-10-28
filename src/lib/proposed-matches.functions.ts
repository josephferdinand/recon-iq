import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const tid = z.string().uuid();

export const listProposedMatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: tid, status: z.string().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("proposed_matches")
      .select("id, run_id, definition_id, members, cardinality, ml_score, rule_hint, status, reviewer_id, reviewed_at, review_note, created_at, definition:recon_definitions(name)")
      .eq("tenant_id", data.tenant_id)
      .order("ml_score", { ascending: false })
      .limit(500);
    if (data.status) q = q.eq("status", data.status as any);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const reviewProposedMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      tenant_id: tid,
      decision: z.enum(["accepted","rejected"]),
      note: z.string().max(2000).optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc(
      "review_proposed_match_atomic",
      { _tenant_id: data.tenant_id, _match_id: data.id, _decision: data.decision, _note: data.note },
    );
    if (error) throw new Error(error.message);
    return result as { ok: boolean; match_id: string | null };
  });

export const bulkReviewProposedMatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: tid,
      ids: z.array(z.string().uuid()).min(1).max(500),
      decision: z.enum(["accepted","rejected"]),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc(
      "review_proposed_matches_atomic",
      { _tenant_id: data.tenant_id, _match_ids: data.ids, _decision: data.decision },
    );
    if (error) throw new Error(error.message);
    return result as { ok: boolean; count: number };
  });
