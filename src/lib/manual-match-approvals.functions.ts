import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const tid = z.string().uuid();

export const listManualMatchApprovals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: tid, status: z.string().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("manual_match_approvals")
      .select("*").eq("tenant_id", data.tenant_id)
      .order("proposed_at", { ascending: false }).limit(200);
    if (data.status) q = q.eq("status", data.status as any);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const proposeManualMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: tid,
      run_id: z.string().uuid().optional(),
      exception_ids: z.array(z.string().uuid()).default([]),
      members: z.record(z.string(), z.any()),
      cardinality: z.string().default("1:1"),
      rationale: z.string().max(2000).optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.from("manual_match_approvals").insert({
      tenant_id: data.tenant_id,
      run_id: data.run_id ?? null,
      exception_ids: data.exception_ids,
      members: data.members,
      cardinality: data.cardinality,
      rationale: data.rationale ?? null,
      proposed_by: context.userId,
    } as any).select("id").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "workspace",
      action: "manual_match.propose", resource_type: "manual_match_approvals",
      resource_id: row.id, context: { cardinality: data.cardinality },
    } as any);
    return row;
  });

export const decideManualMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      tenant_id: tid,
      decision: z.enum(["approved","rejected"]),
      reject_reason: z.string().max(1000).optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc(
      "decide_manual_match_atomic",
      {
        _tenant_id: data.tenant_id,
        _approval_id: data.id,
        _decision: data.decision,
        _reject_reason: data.reject_reason ?? undefined,
      },
    );
    if (error) throw new Error(error.message);
    return result as { ok: boolean; match_id: string | null };
  });
