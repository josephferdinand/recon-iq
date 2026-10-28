// Server functions for cascading rule sets + tolerance ladders (P0 #1).
// All writes are gated by RLS (`approvers_write_*` policies) AND by
// `assertWriter` here for early, clear error messages.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertWriter(ctx: any, tenantId: string) {
  const { data: isAdmin } = await ctx.supabase.rpc("has_tenant_role", {
    _user_id: ctx.userId,
    _tenant_id: tenantId,
    _role: "tenant_admin",
  });
  const { data: isAnalyst } = await ctx.supabase.rpc("has_tenant_role", {
    _user_id: ctx.userId,
    _tenant_id: tenantId,
    _role: "tenant_analyst",
  });
  if (!isAdmin && !isAnalyst) {
    throw new Error("Forbidden: analyst or admin role required");
  }
}

// ---------- Passes ----------

const PassUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  tenant_id: z.string().uuid(),
  recon_id: z.string().uuid(),
  pass_order: z.number().int().min(1).max(20),
  label: z.string().min(2).max(80),
  outcome: z.enum(["auto_match", "match_with_break", "suggest", "review"]),
  rules_json: z.array(z.record(z.string(), z.any())).default([]),
  enabled: z.boolean().default(true),
  notes: z.string().max(500).optional().nullable(),
});

export const listCascadePasses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; recon_id: string }) =>
    z
      .object({ tenant_id: z.string().uuid(), recon_id: z.string().uuid() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("recon_cascade_passes")
      .select("*")
      .eq("tenant_id", data.tenant_id)
      .eq("recon_id", data.recon_id)
      .order("pass_order", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertCascadePass = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => PassUpsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const payload = { ...data, created_by: context.userId };
    const q = data.id
      ? context.supabase
          .from("recon_cascade_passes")
          .update(payload)
          .eq("id", data.id)
          .eq("tenant_id", data.tenant_id)
          .select()
          .single()
      : context.supabase
          .from("recon_cascade_passes")
          .insert(payload)
          .select()
          .single();
    const { data: row, error } = await q;
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: data.id ? "cascade_pass.updated" : "cascade_pass.created",
      resource_type: "recon_cascade_pass",
      resource_id: row.id,
      context: { recon_id: data.recon_id, pass_order: data.pass_order },
    } as any);
    return row;
  });

export const deleteCascadePass = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z
      .object({ id: z.string().uuid(), tenant_id: z.string().uuid() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const { error } = await context.supabase
      .from("recon_cascade_passes")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: "cascade_pass.deleted",
      resource_type: "recon_cascade_pass",
      resource_id: data.id,
    } as any);
    return { ok: true };
  });

// ---------- Ladders ----------

const RungSchema = z.object({
  max_abs: z.number().optional(),
  max_pct: z.number().optional(),
  max_days: z.number().optional(),
  outcome: z.enum(["auto_match", "match_with_break", "suggest", "review"]),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  label: z.string().max(40).optional(),
});

const LadderUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  tenant_id: z.string().uuid(),
  recon_id: z.string().uuid(),
  applies_to_pass_id: z.string().uuid().nullable().optional(),
  field_name: z.string().min(1).max(80),
  field_type: z.enum(["numeric", "date", "string"]),
  rungs_json: z.array(RungSchema).min(1).max(10),
  enabled: z.boolean().default(true),
  notes: z.string().max(500).optional().nullable(),
});

export const listToleranceLadders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; recon_id: string }) =>
    z
      .object({ tenant_id: z.string().uuid(), recon_id: z.string().uuid() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("recon_tolerance_ladders")
      .select("*")
      .eq("tenant_id", data.tenant_id)
      .eq("recon_id", data.recon_id)
      .order("field_name", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertToleranceLadder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => LadderUpsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const payload = { ...data, created_by: context.userId };
    const q = data.id
      ? context.supabase
          .from("recon_tolerance_ladders")
          .update(payload)
          .eq("id", data.id)
          .eq("tenant_id", data.tenant_id)
          .select()
          .single()
      : context.supabase
          .from("recon_tolerance_ladders")
          .insert(payload)
          .select()
          .single();
    const { data: row, error } = await q;
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: data.id ? "tolerance_ladder.updated" : "tolerance_ladder.created",
      resource_type: "recon_tolerance_ladder",
      resource_id: row.id,
      context: { recon_id: data.recon_id, field_name: data.field_name },
    } as any);
    return row;
  });

export const deleteToleranceLadder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z
      .object({ id: z.string().uuid(), tenant_id: z.string().uuid() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const { error } = await context.supabase
      .from("recon_tolerance_ladders")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: "tolerance_ladder.deleted",
      resource_type: "recon_tolerance_ladder",
      resource_id: data.id,
    } as any);
    return { ok: true };
  });
