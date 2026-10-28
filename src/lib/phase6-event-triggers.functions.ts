// Phase 6 — Event-driven reconciliation triggers
// Maps webhook_outbox topic events to recon_schedules. The cron-driven
// orchestrator also drains this table by dispatching matched schedules.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const tid = z.string().uuid();

export const listEventTriggers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("recon_event_triggers")
      .select("*, recon_schedules!inner(id,name,cron_expression,enabled)")
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertEventTrigger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      tenant_id: tid,
      schedule_id: z.string().uuid(),
      event_topic: z.string().min(1).max(120),
      filter: z.record(z.string(), z.unknown()).default({}),
      debounce_seconds: z.number().int().min(0).max(3600).default(30),
      enabled: z.boolean().default(true),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload: Record<string, unknown> = { ...data, created_by: context.userId };
    if (!data.id) delete payload.id;
    const { data: row, error } = await context.supabase
      .from("recon_event_triggers").upsert(payload as never).select("id").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: data.id ? "recon.event_trigger.update" : "recon.event_trigger.create",
      resource_type: "recon_event_triggers", resource_id: row.id,
      context: { event_topic: data.event_topic, schedule_id: data.schedule_id },
    } as never);
    return row;
  });

export const deleteEventTrigger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid(), tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("recon_event_triggers").delete().eq("id", data.id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "recon.event_trigger.delete", resource_type: "recon_event_triggers", resource_id: data.id,
    } as never);
    return { ok: true };
  });
