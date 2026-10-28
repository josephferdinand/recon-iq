import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(ctx: any, tenantId: string) {
  const { data } = await ctx.supabase.rpc("has_tenant_role", {
    _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_admin",
  });
  if (!data) {
    const { data: pa } = await ctx.supabase.rpc("is_platform_admin", { _user_id: ctx.userId });
    if (!pa) throw new Error("Forbidden");
  }
}

export const listChannels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.from("notification_channels")
      .select("*").eq("tenant_id", data.tenant_id).order("created_at");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    id: z.string().uuid().optional(),
    tenant_id: z.string().uuid(),
    channel_type: z.enum(["slack","teams","email","webhook"]),
    name: z.string().min(1).max(120),
    target: z.string().min(3).max(500),
    events: z.array(z.string().min(1).max(80)).min(1).max(20),
    enabled: z.boolean().default(true),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    if (data.channel_type === "slack" && !/^https:\/\/hooks\.slack\.com\//.test(data.target))
      throw new Error("Slack target must be an incoming webhook URL");
    if (data.channel_type === "teams" && !/^https:\/\/.+webhook\.office\.com\//.test(data.target))
      throw new Error("Teams target must be an Office 365 webhook URL");
    if (data.channel_type === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.target))
      throw new Error("Email target must be a valid address");
    const payload = { ...data, updated_at: new Date().toISOString() };
    const { data: row, error } = data.id
      ? await context.supabase.from("notification_channels").update(payload).eq("id", data.id).select().single()
      : await context.supabase.from("notification_channels").insert(payload).select().single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenant_id, scope: "tenant", action: "channel.upsert",
      resource_type: "notification_channels", resource_id: row.id,
      context: { type: data.channel_type, events: data.events, enabled: data.enabled },
    } as any);
    return row;
  });

export const deleteChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    const { error } = await context.supabase.from("notification_channels").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, data.tenant_id);
    const { deliverToChannel } = await import("@/lib/channels.server");
    const { data: ch } = await context.supabase.from("notification_channels")
      .select("*").eq("id", data.id).single();
    if (!ch) throw new Error("Channel not found");
    const r = await deliverToChannel(ch, {
      kind: "channel.test",
      title: "ReconIQ channel test",
      body: "If you can see this, delivery works.",
      severity: "info",
    });
    return r;
  });
