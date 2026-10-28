import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { unread_only?: boolean } | undefined) =>
    z.object({ unread_only: z.boolean().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("notifications")
      .select("id, tenant_id, kind, title, body, link_to, severity, read_at, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (data.unread_only) q = q.is("read_at", null);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id?: string; all?: boolean }) =>
    z.object({ id: z.string().uuid().optional(), all: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();
    let q = context.supabase.from("notifications").update({ read_at: now })
      .eq("user_id", context.userId).is("read_at", null);
    if (data.id) q = q.eq("id", data.id);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      kind: z.string().min(1).max(80),
      title: z.string().min(1).max(200),
      body: z.string().max(2000).optional(),
      link_to: z.string().max(500).optional(),
      severity: z.enum(["info", "success", "warning", "critical"]).default("info"),
      tenant_id: z.string().uuid().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("notifications").insert({
      user_id: context.userId,
      tenant_id: data.tenant_id ?? null,
      kind: data.kind, title: data.title, body: data.body ?? null,
      link_to: data.link_to ?? null, severity: data.severity,
    } as any);
    if (error) throw new Error(error.message);
    if (data.tenant_id) {
      try {
        const { fanout } = await import("@/lib/channels.server");
        await fanout(data.tenant_id, {
          kind: data.kind, title: data.title, body: data.body,
          link_to: data.link_to, severity: data.severity,
        });
      } catch { /* fanout best-effort */ }
    }
    return { ok: true };
  });
