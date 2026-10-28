import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const tenantId = z.string().uuid();

export const listDoraRegister = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tenantId }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("dora_register")
      .select("*")
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertDoraRegister = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      tenant_id: tenantId,
      provider_name: z.string().min(2).max(200),
      service_description: z.string().min(2).max(2000),
      criticality: z.enum(["critical", "important", "non_critical"]).default("important"),
      data_processed: z.string().max(2000).optional().nullable(),
      country: z.string().max(60).optional().nullable(),
      contract_start: z.string().optional().nullable(),
      contract_end: z.string().optional().nullable(),
      status: z.enum(["active", "retired", "onboarding"]).default("active"),
      subcontractors_json: z.array(z.record(z.string(), z.unknown())).default([]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload: any = { ...data, created_by: context.userId };
    if (!data.id) delete payload.id;
    const { data: row, error } = await context.supabase
      .from("dora_register")
      .upsert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: data.id ? "dora.register.update" : "dora.register.create",
      resource_type: "dora_register",
      resource_id: row.id,
      context: { provider: data.provider_name },
    } as any);
    return row;
  });

export const deleteDoraRegister = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid(), tenant_id: tenantId }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("dora_register").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "dora.register.delete", resource_type: "dora_register", resource_id: data.id, context: {},
    } as any);
    return { ok: true };
  });

export const listDoraIncidents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tenantId }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("dora_incidents")
      .select("*")
      .eq("tenant_id", data.tenant_id)
      .order("occurred_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const createDoraIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: tenantId,
      classification: z.enum(["major", "significant", "minor"]).default("major"),
      root_cause: z.string().max(2000).optional().nullable(),
      notes: z.string().max(4000).optional().nullable(),
      reported_to_regulator: z.boolean().default(false),
      regulator_ref: z.string().max(120).optional().nullable(),
      customers_affected: z.number().int().nonnegative().optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("dora_incidents")
      .insert({ ...data, created_by: context.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "dora.incident.create", resource_type: "dora_incidents", resource_id: row.id,
      context: { classification: data.classification },
    } as any);
    return row;
  });

export const listDoraExitPlans = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tenantId }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("dora_exit_plans").select("*")
      .eq("tenant_id", data.tenant_id).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertDoraExitPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      tenant_id: tenantId,
      title: z.string().min(2).max(200),
      trigger_conditions: z.string().max(2000).optional().nullable(),
      rto_hours: z.number().int().min(1).max(720).default(24),
      rpo_minutes: z.number().int().min(0).max(1440).default(60),
      status: z.enum(["draft", "approved", "tested", "expired"]).default("draft"),
      register_id: z.string().uuid().optional().nullable(),
      steps_json: z.array(z.record(z.string(), z.unknown())).default([]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload: any = { ...data, created_by: context.userId };
    if (!data.id) delete payload.id;
    const { data: row, error } = await context.supabase
      .from("dora_exit_plans").upsert(payload).select("id").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: data.id ? "dora.exit_plan.update" : "dora.exit_plan.create",
      resource_type: "dora_exit_plans", resource_id: row.id, context: {},
    } as any);
    return row;
  });

export const doraEvidenceExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tenantId }).parse(d))
  .handler(async ({ data, context }) => {
    const [reg, plans, incs] = await Promise.all([
      context.supabase.from("dora_register").select("*").eq("tenant_id", data.tenant_id),
      context.supabase.from("dora_exit_plans").select("*").eq("tenant_id", data.tenant_id),
      context.supabase.from("dora_incidents").select("*").eq("tenant_id", data.tenant_id),
    ]);
    return {
      generated_at: new Date().toISOString(),
      article_28_register: reg.data ?? [],
      exit_plans: plans.data ?? [],
      incident_register: incs.data ?? [],
    };
  });
