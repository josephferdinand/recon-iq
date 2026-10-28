import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listSavedViews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; scope: string }) =>
    z.object({ tenant_id: z.string().uuid(), scope: z.string().min(1).max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("saved_views")
      .select("id, name, filters, is_shared, user_id, created_at")
      .eq("tenant_id", data.tenant_id).eq("scope", data.scope)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertSavedView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      tenant_id: z.string().uuid(),
      scope: z.string().min(1).max(40),
      name: z.string().min(1).max(80),
      filters: z.record(z.string(), z.any()),
      is_shared: z.boolean().default(false),
    }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.id) {
      const { error } = await context.supabase.from("saved_views")
        .update({ name: data.name, filters: data.filters, is_shared: data.is_shared })
        .eq("id", data.id).eq("user_id", context.userId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await context.supabase.from("saved_views")
      .insert({
        tenant_id: data.tenant_id, scope: data.scope, name: data.name,
        filters: data.filters, is_shared: data.is_shared, user_id: context.userId,
      } as any).select("id").single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteSavedView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("saved_views")
      .delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
