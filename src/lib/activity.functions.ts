import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getActivityFor = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; resource_type?: string; resource_id?: string; limit?: number }) =>
    z.object({
      tenant_id: z.string().uuid(),
      resource_type: z.string().max(60).optional(),
      resource_id: z.string().max(120).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }).parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("audit_log")
      .select("id, scope, action, resource_type, resource_id, actor_user_id, context, occurred_at")
      .eq("tenant_id", data.tenant_id)
      .order("occurred_at", { ascending: false })
      .limit(data.limit);
    if (data.resource_type) q = q.eq("resource_type", data.resource_type);
    if (data.resource_id) q = q.eq("resource_id", data.resource_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
