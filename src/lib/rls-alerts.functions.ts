// Tenant-scoped RLS-denial-spike alert thresholds.
// Only platform admins manage rows; tenant admins may read their own override.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertPlatformAdmin(ctx: any) {
  const { data: isAdmin } = await ctx.supabase.rpc("is_platform_admin", { _user_id: ctx.userId });
  if (!isAdmin) throw new Error("Forbidden: platform admin required");
}

export const listRlsAlertThresholds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await context.supabase
      .from("rls_alert_thresholds")
      .select("*, tenant:tenants(id, name, slug)")
      .order("tenant_id", { ascending: true, nullsFirst: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  tenant_id: z.string().uuid().nullable(),
  window_minutes: z.number().int().min(1).max(1440),
  threshold: z.number().int().min(1),
  cooldown_minutes: z.number().int().min(1).max(1440),
  severity: z.enum(["info", "warning", "critical"]),
  resource_filter: z.string().trim().min(1).max(200).nullable().optional(),
  enabled: z.boolean(),
});

export const upsertRlsAlertThreshold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => upsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const row = {
      tenant_id: data.tenant_id,
      window_minutes: data.window_minutes,
      threshold: data.threshold,
      cooldown_minutes: data.cooldown_minutes,
      severity: data.severity,
      resource_filter: data.resource_filter ?? null,
      enabled: data.enabled,
      updated_by: context.userId,
    };
    const q = data.id
      ? context.supabase.from("rls_alert_thresholds").update(row).eq("id", data.id).select("*").single()
      : context.supabase.from("rls_alert_thresholds")
          .insert({ ...row, created_by: context.userId })
          .select("*").single();
    const { data: out, error } = await q;
    if (error) throw new Error(error.message);
    return out;
  });

export const deleteRlsAlertThreshold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    // Never delete the platform-wide default (tenant_id IS NULL).
    const { data: row } = await context.supabase
      .from("rls_alert_thresholds").select("tenant_id").eq("id", data.id).maybeSingle();
    if (row && row.tenant_id === null) throw new Error("Cannot delete the platform-wide default row");
    const { error } = await context.supabase.from("rls_alert_thresholds").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const evaluateRlsAlertsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("evaluate_rls_alerts" as any);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listTenantsLite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data, error } = await context.supabase
      .from("tenants").select("id, name, slug").order("name").limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
