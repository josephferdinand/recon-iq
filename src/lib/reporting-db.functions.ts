import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const tid = z.string().uuid();

export const listReportingExports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("reporting_db_exports").select("*")
      .eq("tenant_id", data.tenant_id).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertReportingExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      tenant_id: tid,
      name: z.string().min(2).max(80),
      format: z.enum(["parquet","csv","jsonl"]).default("parquet"),
      destination_kind: z.enum(["s3","gcs","azure","snowflake","redshift","bigquery","sftp"]).default("s3"),
      destination_config: z.record(z.string(), z.any()).default({}),
      scope: z.record(z.string(), z.any()).default({}),
      schedule_cron: z.string().max(80).optional().nullable(),
      is_enabled: z.boolean().default(true),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const payload: any = { ...data, created_by: context.userId };
    if (!data.id) delete payload.id;
    const { data: row, error } = await context.supabase
      .from("reporting_db_exports").upsert(payload).select("id").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: data.id ? "reporting.export.update" : "reporting.export.create",
      resource_type: "reporting_db_exports", resource_id: row.id,
      context: { name: data.name, kind: data.destination_kind },
    } as any);
    return row;
  });

export const triggerReportingExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    // Stub: counts the rows we'd ship; an external worker handles real export
    const { count } = await context.supabase
      .from("recon_runs").select("id", { count: "exact", head: true })
      .eq("tenant_id", data.tenant_id);
    const { error } = await context.supabase
      .from("reporting_db_exports").update({
        last_run_at: new Date().toISOString(),
        last_run_status: "queued",
        last_run_rows: count ?? 0,
        last_run_error: null,
      }).eq("id", data.id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "reporting.export.trigger", resource_type: "reporting_db_exports",
      resource_id: data.id, context: { rows: count ?? 0 },
    } as any);
    return { ok: true, queued_rows: count ?? 0 };
  });
