import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({
  tenant_id: z.string().uuid(),
  page: z.number().int().min(0).max(400).default(0),
});

const PAGE_SIZE = 25;

/** Personal Workspace history: actor identity comes only from the verified session. */
export const listMyWorkspaceAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }) => {
    const from = data.page * PAGE_SIZE;
    const { data: rows, error } = await context.supabase
      .from("audit_log")
      .select("id,occurred_at,scope,action,resource_type,resource_id,row_hash,prev_hash")
      .eq("tenant_id", data.tenant_id)
      .eq("actor_user_id", context.userId)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE_SIZE);
    if (error) {
      console.error("Personal Workspace audit read failed");
      if (error.code === "42501") throw new Error("Forbidden: your access does not allow personal audit records.");
      throw new Error("Your audit trail is temporarily unavailable. Please try again.");
    }
    const visible = rows ?? [];
    return {
      actor_id: context.userId,
      rows: visible.slice(0, PAGE_SIZE),
      has_more: visible.length > PAGE_SIZE && data.page < 400,
      window_limit_reached: visible.length > PAGE_SIZE && data.page === 400,
    };
  });
