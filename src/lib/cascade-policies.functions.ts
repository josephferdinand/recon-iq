// Cascade outcome policies — list, upsert, simulate, telemetry rollup.
// Step 2 of Matching Engine v2.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const TenantOnly = z.object({ tenant_id: z.string().uuid() });

const PolicyUpsert = z.object({
  id: z.string().uuid().optional(),
  tenant_id: z.string().uuid(),
  recon_definition_id: z.string().uuid(),
  name: z.string().min(2).max(120),
  pass_order: z.array(z.string()).max(20).default([]),
  on_match: z.enum(["stop", "continue", "next_pass"]).default("stop"),
  on_no_match: z.enum(["stop", "next_pass", "escalate"]).default("next_pass"),
  carry_forward_unmatched: z.boolean().default(true),
  max_passes: z.number().int().min(1).max(20).default(5),
  telemetry_enabled: z.boolean().default(true),
  is_active: z.boolean().default(true),
});

export const listCascadePolicies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) => TenantOnly.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("recon_cascade_policies")
      .select("*")
      .eq("tenant_id", data.tenant_id)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertCascadePolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => PolicyUpsert.parse(d))
  .handler(async ({ data, context }) => {
    const payload = { ...data, created_by: context.userId };
    const { data: row, error } = await context.supabase
      .from("recon_cascade_policies")
      .upsert(payload as never, { onConflict: "id" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

const SimInput = z.object({
  tenant_id: z.string().uuid(),
  policy_id: z.string().uuid(),
  recon_run_id: z.string().uuid(),
});

export const runCascadeSimulation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => SimInput.parse(d))
  .handler(async ({ data, context }) => {
    // Tenant membership is also enforced inside simulate_cascade_policy(),
    // but we short-circuit early so the UI gets a clean error.
    const { data: member } = await context.supabase
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", data.tenant_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!member) throw new Error("Forbidden: not a tenant member");

    // Create a running sim row for audit trail.
    const { data: sim, error: insErr } = await context.supabase
      .from("recon_cascade_simulations")
      .insert({
        tenant_id: data.tenant_id,
        policy_id: data.policy_id,
        recon_run_id: data.recon_run_id,
        recon_definition_id: data.policy_id, // temp; resolved below
        initiated_by: context.userId,
        status: "running",
      } as never)
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    const { data: breakdown, error: simErr } = await context.supabase.rpc(
      "simulate_cascade_policy",
      {
        _tenant_id: data.tenant_id,
        _policy_id: data.policy_id,
        _recon_run_id: data.recon_run_id,
      },
    );
    if (simErr) {
      await context.supabase
        .from("recon_cascade_simulations")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          warnings: [{ error: simErr.message }],
        } as never)
        .eq("id", sim.id);
      throw new Error(simErr.message);
    }

    const rows = (breakdown ?? []) as Array<{
      ordinal: number;
      candidates_in: number;
      matches_out: number;
      carry_forward_out: number;
    }>;
    const matches = rows.reduce((a, r) => a + (r.matches_out ?? 0), 0);
    const carry = rows.length
      ? (rows[rows.length - 1].carry_forward_out ?? 0)
      : 0;

    const { data: finalRow, error: updErr } = await context.supabase
      .from("recon_cascade_simulations")
      .update({
        status: "succeeded",
        finished_at: new Date().toISOString(),
        passes_evaluated: rows.length,
        matches_projected: matches,
        carry_forward_projected: carry,
        per_pass_breakdown: rows,
      } as never)
      .eq("id", sim.id)
      .select("*")
      .single();
    if (updErr) throw new Error(updErr.message);
    return finalRow;
  });

export const listCascadeTelemetry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; limit?: number }) =>
    z
      .object({
        tenant_id: z.string().uuid(),
        limit: z.number().int().min(1).max(500).default(50),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("recon_cascade_telemetry")
      .select("*")
      .eq("tenant_id", data.tenant_id)
      .order("recorded_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
