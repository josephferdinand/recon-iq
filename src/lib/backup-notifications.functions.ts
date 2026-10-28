// Platform · Backup notification channels (email / webhook / Slack).
// Platform Super Admins only. Dispatch is invoked from other server functions
// when an SLA breach or backup/restore failure event is recorded.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertSuper(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("is_platform_super_admin", { _user_id: context.userId });
  if (!data) throw new Error("Forbidden: platform_super_admin required");
}

export type NotificationChannel = {
  id: string;
  channel_type: "email" | "webhook" | "slack";
  label: string;
  target: string;
  enabled: boolean;
  notify_on: string[];
  secret: string | null;
  last_dispatched_at: string | null;
  last_status: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export const NOTIFY_EVENTS = [
  "sla_breach",
  "backup_failed",
  "restore_failed",
  "restore_completed",
  "config_change",
  "kb_approval_requested",
] as const;

export const listBackupNotificationChannels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }): Promise<NotificationChannel[]> => {
    await assertSuper(context);
    const { data, error } = await context.supabase
      .from("platform_backup_notification_channels")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as NotificationChannel[];
  });

const UpsertInput = z.object({
  id: z.string().uuid().optional(),
  channel_type: z.enum(["email", "webhook", "slack"]),
  label: z.string().min(1).max(120),
  target: z.string().min(3).max(500),
  enabled: z.boolean().default(true),
  notify_on: z.array(z.enum(NOTIFY_EVENTS)).min(1),
  secret: z.string().max(200).nullable().optional(),
});

export const upsertBackupNotificationChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((v) => UpsertInput.parse(v))
  .handler(async ({ data, context }) => {
    await assertSuper(context);
    // Basic target validation per channel
    if (data.channel_type === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.target)) {
      throw new Error("Invalid email address");
    }
    if ((data.channel_type === "webhook" || data.channel_type === "slack") && !/^https:\/\//.test(data.target)) {
      throw new Error("Webhook target must be an https:// URL");
    }

    const row: any = {
      channel_type: data.channel_type,
      label: data.label,
      target: data.target,
      enabled: data.enabled,
      notify_on: data.notify_on,
      secret: data.secret ?? null,
    };
    if (data.id) row.id = data.id;
    else row.created_by = context.userId;

    const { data: saved, error } = await context.supabase
      .from("platform_backup_notification_channels")
      .upsert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      action: data.id ? "platform_backup.channel_updated" : "platform_backup.channel_created",
      scope: "platform",
      resource_type: "platform_backup_notification_channel",
      resource_id: saved.id,
      context: { ...row, secret: row.secret ? "***" : null },
    } as any);
    return saved as NotificationChannel;
  });

export const deleteBackupNotificationChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((v) => z.object({ id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    await assertSuper(context);
    const { error } = await context.supabase
      .from("platform_backup_notification_channels")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      action: "platform_backup.channel_deleted",
      scope: "platform",
      resource_type: "platform_backup_notification_channel",
      resource_id: data.id,
      context: {},
    } as any);
    return { ok: true };
  });

// Dispatch a payload to a single channel. Used by the "test" button and by
// internal alerting hooks. Never throws — records success/failure on the row.
async function dispatchToChannel(supabase: any, channel: NotificationChannel, payload: {
  event: string;
  subject: string;
  body: string;
  metadata?: Record<string, any>;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    if (channel.channel_type === "email") {
      // Enqueue through the platform email queue if available; otherwise no-op.
      const { error } = await supabase.rpc("enqueue_email", {
        _queue: "transactional_emails",
        _payload: {
          to: channel.target,
          subject: payload.subject,
          template: "platform_backup_alert",
          data: { body: payload.body, event: payload.event, metadata: payload.metadata ?? {} },
        },
      } as any);
      if (error && !/does not exist|not found/i.test(error.message)) throw new Error(error.message);
    } else if (channel.channel_type === "slack") {
      const res = await fetch(channel.target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `*${payload.subject}*\n${payload.body}`,
          attachments: [{ color: payload.event.includes("fail") || payload.event === "sla_breach" ? "danger" : "warning" }],
        }),
      });
      if (!res.ok) throw new Error(`Slack HTTP ${res.status}`);
    } else {
      // generic webhook, optional HMAC signature
      const body = JSON.stringify({ ...payload, sent_at: new Date().toISOString() });
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (channel.secret) {
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey(
          "raw", enc.encode(channel.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
        );
        const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
        headers["X-FVI-Signature"] = "sha256=" + Array.from(new Uint8Array(sig))
          .map((b) => b.toString(16).padStart(2, "0")).join("");
      }
      const res = await fetch(channel.target, { method: "POST", headers, body });
      if (!res.ok) throw new Error(`Webhook HTTP ${res.status}`);
    }
    await supabase.from("platform_backup_notification_channels")
      .update({ last_dispatched_at: new Date().toISOString(), last_status: "ok", last_error: null })
      .eq("id", channel.id);
    return { ok: true };
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    await supabase.from("platform_backup_notification_channels")
      .update({ last_dispatched_at: new Date().toISOString(), last_status: "error", last_error: msg })
      .eq("id", channel.id);
    return { ok: false, error: msg };
  }
}

export const testBackupNotificationChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((v) => z.object({ id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    await assertSuper(context);
    const { data: ch, error } = await context.supabase
      .from("platform_backup_notification_channels").select("*").eq("id", data.id).maybeSingle();
    if (error || !ch) throw new Error(error?.message ?? "Channel not found");
    const result = await dispatchToChannel(context.supabase, ch as NotificationChannel, {
      event: "test",
      subject: "[ReconIQ] Backup notifications — test",
      body: `This is a test alert from ReconIQ Platform Backup notifications (${ch.label}).`,
    });
    if (!result.ok) throw new Error(result.error ?? "Dispatch failed");
    return { ok: true };
  });

/** Dispatch an alert to every enabled channel that subscribes to `event`. */
export async function fanOutBackupAlert(
  supabase: any,
  event: string,
  subject: string,
  body: string,
  metadata?: Record<string, any>,
) {
  const { data } = await supabase
    .from("platform_backup_notification_channels")
    .select("*")
    .eq("enabled", true)
    .contains("notify_on", [event]);
  const chans = (data ?? []) as NotificationChannel[];
  await Promise.all(chans.map((c) => dispatchToChannel(supabase, c, { event, subject, body, metadata })));
}
