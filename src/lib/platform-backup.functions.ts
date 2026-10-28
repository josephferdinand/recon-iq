import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fanOutBackupAlert } from "@/lib/backup-notifications.functions";


/** Assert the caller is a Platform Super Admin. Throws 403 otherwise. */
async function assertSuper(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("is_platform_super_admin", {
    _user_id: context.userId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: platform_super_admin required");
}

export const getPlatformBackupStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertSuper(context);
    const { data, error } = await context.supabase
      .from("platform_backup_config")
      .select("*")
      .eq("id", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

const UpdateInput = z.object({
  pitr_enabled: z.boolean(),
  retention_days: z.number().int().min(1).max(90),
  daily_snapshot_retention_days: z.number().int().min(1).max(90),
  latest_snapshot_at: z.string().datetime().nullable().optional(),
  latest_pitr_window_start: z.string().datetime().nullable().optional(),
  latest_pitr_window_end: z.string().datetime().nullable().optional(),
  provider: z.string().min(1).max(64),
  provider_notes: z.string().max(2000).nullable().optional(),
  snapshot_sla_hours: z.number().int().min(1).max(720).optional(),
  alerts_enabled: z.boolean().optional(),
  change_note: z.string().max(500).optional(),
});

export const updatePlatformBackupConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => UpdateInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertSuper(context);
    const { change_note, ...cfg } = data;
    const patch = { ...cfg, updated_by: context.userId, updated_at: new Date().toISOString() };
    const { data: updated, error } = await context.supabase
      .from("platform_backup_config")
      .update(patch)
      .eq("id", true)
      .select()
      .single();
    if (error) throw new Error(error.message);

    // Actor email for audit convenience
    const { data: profile } = await context.supabase
      .from("profiles").select("email").eq("id", context.userId).maybeSingle();

    await context.supabase.from("platform_backup_events").insert({
      event_type: "config_change",
      actor_id: context.userId,
      actor_email: profile?.email ?? null,
      notes: change_note ?? "Backup configuration updated",
      metadata: {
        pitr_enabled: cfg.pitr_enabled,
        retention_days: cfg.retention_days,
        daily_snapshot_retention_days: cfg.daily_snapshot_retention_days,
        provider: cfg.provider,
      },
    });

    // Cross-write to the platform-wide audit_log
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      action: "platform_backup.config_change",
      scope: "platform",
      resource_type: "platform_backup_config",
      resource_id: "singleton",
      context: patch,
    } as any);

    return updated;
  });

const EventInput = z.object({
  event_type: z.enum([
    "snapshot_recorded","restore_requested","restore_approved",
    "restore_started","restore_completed","restore_failed",
    "pitr_enabled","pitr_disabled","test_drill",
  ]),
  target_recovery_at: z.string().datetime().nullable().optional(),
  restored_at: z.string().datetime().nullable().optional(),
  scope: z.string().max(120).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const recordBackupEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => EventInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertSuper(context);
    const { data: profile } = await context.supabase
      .from("profiles").select("email").eq("id", context.userId).maybeSingle();

    const row = {
      ...data,
      metadata: data.metadata ?? {},
      actor_id: context.userId,
      actor_email: profile?.email ?? null,
    };
    const { data: inserted, error } = await context.supabase
      .from("platform_backup_events").insert(row).select().single();
    if (error) throw new Error(error.message);

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      action: `platform_backup.${data.event_type}`,
      scope: "platform",
      resource_type: "platform_backup_event",
      resource_id: inserted.id,
      context: row,
    } as any);

    // Fan out to notification channels for failure / restore_completed events.
    const alertMap: Record<string, string> = {
      restore_failed: "restore_failed",
      backup_failed: "backup_failed",
      restore_completed: "restore_completed",
    };
    const evt = alertMap[data.event_type];
    if (evt) {
      const subject = `[ReconIQ] Backup event: ${data.event_type}`;
      const body = [
        `Event: ${data.event_type}`,
        data.scope ? `Scope: ${data.scope}` : null,
        data.notes ? `Notes: ${data.notes}` : null,
        `Actor: ${profile?.email ?? context.userId}`,
      ].filter(Boolean).join("\n");
      await fanOutBackupAlert(context.supabase, evt, subject, body, { event_id: inserted.id, ...row });
    }

    return inserted;
  });


const ListInput = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  event_type: z.string().optional(),
});

export const listBackupEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => ListInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await assertSuper(context);
    let q = context.supabase
      .from("platform_backup_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.event_type) q = q.eq("event_type", data.event_type);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
