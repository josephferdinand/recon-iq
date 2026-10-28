import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const heartbeatPresence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; resource_type: string; resource_id: string }) =>
    z.object({
      tenant_id: z.string().uuid(),
      resource_type: z.string().min(1).max(80),
      resource_id: z.string().min(1).max(200),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("recon_presence").upsert({
      tenant_id: data.tenant_id, user_id: context.userId,
      resource_type: data.resource_type, resource_id: data.resource_id,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: "user_id,resource_type,resource_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listPresence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; resource_type: string; resource_id: string }) =>
    z.object({
      tenant_id: z.string().uuid(),
      resource_type: z.string().min(1).max(80),
      resource_id: z.string().min(1).max(200),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const cutoff = new Date(Date.now() - 60_000).toISOString();
    const { data: rows, error } = await context.supabase.from("recon_presence")
      .select("user_id, last_seen_at, profiles!inner(full_name, email, avatar_url)")
      .eq("tenant_id", data.tenant_id)
      .eq("resource_type", data.resource_type)
      .eq("resource_id", data.resource_id)
      .gte("last_seen_at", cutoff);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const leavePresence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { resource_type: string; resource_id: string }) =>
    z.object({
      resource_type: z.string().min(1).max(80),
      resource_id: z.string().min(1).max(200),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await context.supabase.from("recon_presence")
      .delete()
      .eq("user_id", context.userId)
      .eq("resource_type", data.resource_type)
      .eq("resource_id", data.resource_id);
    return { ok: true };
  });
