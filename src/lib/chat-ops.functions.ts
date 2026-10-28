import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const tenantId = z.string().uuid();

export const listChatOps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tenantId }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("chat_ops_subscriptions")
      .select("id,platform,channel,webhook_url,events,enabled,created_at")
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertChatOps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    id: z.string().uuid().optional(),
    tenant_id: tenantId,
    platform: z.enum(["slack", "email", "teams"]).default("slack"),
    channel: z.string().min(1).max(200),
    webhook_url: z.string().url().max(2000).optional().nullable(),
    events: z.array(z.string().min(1).max(80)).default([]),
    enabled: z.boolean().default(true),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const payload: any = { ...data, created_by: context.userId };
    if (!data.id) delete payload.id;
    const { data: row, error } = await context.supabase
      .from("chat_ops_subscriptions").upsert(payload).select("id").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: data.id ? "chatops.update" : "chatops.create",
      resource_type: "chat_ops_subscriptions", resource_id: row.id,
      context: { platform: data.platform, channel: data.channel },
    } as any);
    return row;
  });

export const deleteChatOps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid(), tenant_id: tenantId }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("chat_ops_subscriptions").delete()
      .eq("id", data.id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testChatOps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid(), tenant_id: tenantId }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: sub, error } = await context.supabase
      .from("chat_ops_subscriptions").select("platform,channel,webhook_url")
      .eq("id", data.id).eq("tenant_id", data.tenant_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!sub) throw new Error("Subscription not found");
    if (!sub.webhook_url) return { ok: false, reason: "No webhook URL configured" };
    try {
      const r = await fetch(sub.webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `:white_check_mark: ReconIQ Chat-Ops test from Demo Bank — channel ${sub.channel}`,
        }),
      });
      return { ok: r.ok, status: r.status };
    } catch (e: any) {
      return { ok: false, reason: String(e?.message ?? e) };
    }
  });
