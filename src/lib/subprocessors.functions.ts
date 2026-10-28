import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listSubProcessors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId: string }) => z.object({ tenantId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("sub_processors")
      .select("*")
      .or(`tenant_id.eq.${data.tenantId},tenant_id.is.null`)
      .order("name", { ascending: true });
    return rows ?? [];
  });

export const upsertSubProcessor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: {
    id?: string; tenantId: string; name: string; purpose: string;
    region?: string; website?: string; dpa_url?: string; data_categories?: string[];
    active?: boolean;
  }) => z.object({
    id: z.string().uuid().optional(),
    tenantId: z.string().uuid(),
    name: z.string().min(1),
    purpose: z.string().min(1),
    region: z.string().optional(),
    website: z.string().url().optional(),
    dpa_url: z.string().url().optional(),
    data_categories: z.array(z.string()).optional(),
    active: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const row = {
      tenant_id: data.tenantId,
      name: data.name,
      purpose: data.purpose,
      region: data.region,
      website: data.website,
      dpa_url: data.dpa_url,
      data_categories: data.data_categories ?? [],
      active: data.active ?? true,
      updated_at: new Date().toISOString(),
    } as never;
    // Defense-in-depth: for updates, require the row to belong to the caller's tenant.
    const q = data.id
      ? context.supabase.from("sub_processors").update(row).eq("id", data.id).eq("tenant_id", data.tenantId)
      : context.supabase.from("sub_processors").insert(row);
    const { error } = await q;
    if (error) throw new Response(error.message, { status: 500 });
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenantId, scope: "tenant",
      action: data.id ? "subprocessor.update" : "subprocessor.create",
      resource_type: "sub_processors", resource_id: data.id ?? null,
      context: { name: data.name, purpose: data.purpose, region: data.region ?? null },
    } as any);
    return { ok: true };
  });

export const deleteSubProcessor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenantId: string }) => z.object({ id: z.string().uuid(), tenantId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("sub_processors").delete()
      .eq("id", data.id)
      .eq("tenant_id", data.tenantId);
    if (error) throw new Response(error.message, { status: 500 });
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenantId, scope: "tenant",
      action: "subprocessor.delete", resource_type: "sub_processors", resource_id: data.id,
      context: {},
    } as any);
    return { ok: true };
  });
