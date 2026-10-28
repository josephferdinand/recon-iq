// Phase 6 — ABAC predicates layered on top of RBAC.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const tid = z.string().uuid();

export const listAbacPredicates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("rbac_abac_predicates").select("*").eq("tenant_id", data.tenant_id)
      .order("permission_id");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertAbacPredicate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      tenant_id: tid,
      permission_id: z.string().min(1).max(120),
      attribute: z.string().min(1).max(80),
      operator: z.enum(["in", "not_in", "equals"]).default("in"),
      values: z.array(z.string()).min(0),
      description: z.string().max(400).optional().nullable(),
      enabled: z.boolean().default(true),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload: Record<string, unknown> = { ...data, created_by: context.userId };
    if (!data.id) delete payload.id;
    const { data: row, error } = await context.supabase
      .from("rbac_abac_predicates").upsert(payload as never).select("id").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: data.id ? "rbac.abac.update" : "rbac.abac.create",
      resource_type: "rbac_abac_predicates", resource_id: row.id,
      context: { permission_id: data.permission_id, attribute: data.attribute, operator: data.operator },
    } as never);
    return row;
  });

export const deleteAbacPredicate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid(), tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("rbac_abac_predicates").delete().eq("id", data.id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "rbac.abac.delete", resource_type: "rbac_abac_predicates", resource_id: data.id,
    } as never);
    return { ok: true };
  });

export const checkAbacPermission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: tid,
      permission_id: z.string(),
      attributes: z.record(z.string(), z.unknown()).default({}),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: allowed, error } = await context.supabase.rpc("has_permission_abac", {
      _user_id: context.userId,
      _permission: data.permission_id,
      _tenant_id: data.tenant_id,
      _attributes: data.attributes as never,
    } as never);
    if (error) throw new Error(error.message);
    return { allowed: !!allowed };
  });
