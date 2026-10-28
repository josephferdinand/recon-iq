import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isValidReconCron } from "@/lib/recon-cron";
import { z } from "zod";

const ScheduleInput = z.object({
  id: z.string().uuid().optional(),
  tenant_id: z.string().uuid(),
  definition_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  cron_expression: z.string().min(5).max(120).refine(isValidReconCron, "Invalid 5-field UTC cron expression"),
  enabled: z.boolean().default(false),
});

async function assertScheduler(
  context: { supabase: any; userId: string },
  tenant_id: string,
) {
  const { data: isAdmin } = await context.supabase.rpc("is_platform_admin", {
    _user_id: context.userId,
  });
  if (isAdmin) return;
  const { data: row, error } = await context.supabase
    .from("tenant_members")
    .select("role")
    .eq("tenant_id", tenant_id)
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row || (row.role !== "tenant_admin" && row.role !== "tenant_analyst")) {
    throw new Error("Forbidden");
  }
}

export const listReconSchedules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) =>
    z.object({ tenant_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("recon_schedules")
      .select(
        "id, name, cron_expression, enabled, last_run_at, last_status, last_run_id, last_error, last_dispatched_for, max_attempts, retry_backoff_seconds, catch_up_window_minutes, definition_id, definition:recon_definitions(name, recon_type)",
      )
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertReconSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => ScheduleInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertScheduler(context, data.tenant_id);
    const payload: any = {
      tenant_id: data.tenant_id,
      definition_id: data.definition_id,
      name: data.name,
      cron_expression: data.cron_expression,
      enabled: data.enabled,
    };
    const { data: row, error } = data.id
      ? await context.supabase
          .from("recon_schedules")
          .update(payload)
          .eq("id", data.id)
          .eq("tenant_id", data.tenant_id)
          .select()
          .single()
      : await context.supabase
          .from("recon_schedules")
          .insert({ ...payload, created_by: context.userId })
          .select()
          .single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: data.id ? "recon.schedule.update" : "recon.schedule.create",
      resource_type: "recon_schedule",
      resource_id: row.id,
      context: { name: row.name, cron_expression: row.cron_expression, enabled: row.enabled },
    } as any);
    return row;
  });

export const deleteReconSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertScheduler(context, data.tenant_id);
    const { error } = await context.supabase
      .from("recon_schedules")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: "recon.schedule.delete",
      resource_type: "recon_schedule",
      resource_id: data.id,
      context: {},
    } as any);
    return { ok: true };
  });

export const triggerReconScheduleNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertScheduler(context, data.tenant_id);
    const { executeReconSchedule } = await import("@/lib/recon-orchestrator.server");
    return executeReconSchedule(data.id, data.tenant_id, "manual", context.userId);
  });

export const listScheduleRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { schedule_id: string; tenant_id: string }) =>
    z
      .object({
        schedule_id: z.string().uuid(),
        tenant_id: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("recon_schedule_runs")
      .select(
        "id, trigger, status, scheduled_for, started_at, finished_at, matched_count, exception_count, total_rows, error, recon_run_id, attempt, max_attempts, retry_after, superseded_by_id",
      )
      .eq("schedule_id", data.schedule_id)
      .eq("tenant_id", data.tenant_id)
      .order("started_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
