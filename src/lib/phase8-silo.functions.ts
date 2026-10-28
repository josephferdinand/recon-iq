/**
 * Phase 8 — Enterprise silo tier server fns.
 *
 * Catalog browsing, per-tenant silo assignment lifecycle, and the
 * sales-led schema-per-tenant request workflow.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertPhaseCPerm } from "./phase-c-rbac.functions";

export const listSiloTiers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({}).parse(d))
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("silo_tier_catalog")
      .select("code,name,description,isolation_kind,enabled")
      .eq("enabled", true)
      .order("code");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listTenantSiloAssignments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tenant_silo_assignments")
      .select("id,silo_tier_code,region,cluster_handle,status,notes,requested_at,activated_at,retired_at")
      .eq("tenant_id", data.tenant_id)
      .order("requested_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const requestSiloAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      silo_tier_code: z.string().min(2),
      region: z.string().min(2).max(64).optional(),
      notes: z.string().max(2000).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload = { ...data, status: "requested", created_by: context.userId };
    const { data: row, error } = await context.supabase
      .from("tenant_silo_assignments")
      .upsert(payload as never, { onConflict: "tenant_id,silo_tier_code" })
      .select("id,silo_tier_code,status")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listSchemaPerTenantRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: z.string().uuid(), openOnly: z.boolean().default(false) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPhaseCPerm(context, data.tenant_id, "schema_view");
    let q = context.supabase
      .from("schema_per_tenant_requests")
      .select("id,regulator_ref,justification,status,decided_at,notes,created_at")
      .eq("tenant_id", data.tenant_id);
    if (data.openOnly) q = q.eq("status", "open");
    const { data: rows, error } = await q.order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const createSchemaPerTenantRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      regulator_ref: z.string().max(200).optional(),
      justification: z.string().min(10).max(4000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPhaseCPerm(context, data.tenant_id, "schema_request");
    const payload = { ...data, requested_by: context.userId, status: "open" };
    const { data: row, error } = await context.supabase
      .from("schema_per_tenant_requests")
      .insert(payload as never)
      .select("id,status")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });
