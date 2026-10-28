// Per-tenant backup cadence + SLA server functions. Platform-admin only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { differenceInHours, startOfDay, subDays, format } from "date-fns";

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("is_platform_admin", { _user_id: context.userId });
  if (!data) throw new Error("Forbidden: platform admin required");
}

export type TenantBackupRow = {
  tenant_id: string;
  slug: string;
  name: string;
  environment: string;
  latest_snapshot_at: string | null;
  age_hours: number | null;
  sla_hours: number;
  alerts_enabled: boolean;
  sla_breached: boolean;
  failed_events_30d: number;
  snapshot_days_30d: number;
  cadence_30d: { d: string; c: number }[];
  notes: string | null;
};

export const listTenantBackupCadence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }): Promise<{ tenants: TenantBackupRow[]; platform_sla_hours: number }> => {
    await assertAdmin(context);

    const [tenantsRes, slasRes, eventsRes, cfgRes] = await Promise.all([
      context.supabase.from("tenants").select("id, slug, name, environment").order("name"),
      context.supabase.from("tenant_backup_slas").select("*"),
      context.supabase
        .from("platform_backup_events")
        .select("tenant_id, event_type, created_at")
        .gte("created_at", subDays(new Date(), 30).toISOString())
        .order("created_at", { ascending: false }),
      context.supabase.from("platform_backup_config").select("snapshot_sla_hours").eq("id", true).maybeSingle(),
    ]);

    if (tenantsRes.error) throw new Error(tenantsRes.error.message);
    const platformSla = cfgRes.data?.snapshot_sla_hours ?? 26;
    const slaMap = new Map<string, { sla: number; alerts: boolean; notes: string | null }>();
    for (const s of (slasRes.data ?? []) as any[]) {
      slaMap.set(s.tenant_id, {
        sla: s.snapshot_sla_hours,
        alerts: s.alerts_enabled,
        notes: s.notes,
      });
    }

    // Group events by tenant
    const byTenant = new Map<string, any[]>();
    for (const e of (eventsRes.data ?? []) as any[]) {
      if (!e.tenant_id) continue;
      const arr = byTenant.get(e.tenant_id) ?? [];
      arr.push(e);
      byTenant.set(e.tenant_id, arr);
    }

    const today = startOfDay(new Date());
    const rows: TenantBackupRow[] = ((tenantsRes.data ?? []) as any[]).map((t) => {
      const evs = byTenant.get(t.id) ?? [];
      const snapshots = evs.filter((e) => e.event_type === "snapshot_recorded");
      const latest = snapshots[0]?.created_at ?? null;
      const age = latest ? differenceInHours(new Date(), new Date(latest)) : null;
      const override = slaMap.get(t.id);
      const sla = override?.sla ?? platformSla;
      const alertsOn = override?.alerts ?? true;
      const breached = alertsOn && (age === null || age > sla);

      // 30-day cadence buckets
      const bucketMap = new Map<string, number>();
      for (let i = 29; i >= 0; i--) {
        bucketMap.set(format(subDays(today, i), "yyyy-MM-dd"), 0);
      }
      for (const s of snapshots) {
        const k = format(startOfDay(new Date(s.created_at)), "yyyy-MM-dd");
        if (bucketMap.has(k)) bucketMap.set(k, (bucketMap.get(k) ?? 0) + 1);
      }
      const cadence = Array.from(bucketMap.entries()).map(([d, c]) => ({ d, c }));

      return {
        tenant_id: t.id,
        slug: t.slug,
        name: t.name,
        environment: t.environment,
        latest_snapshot_at: latest,
        age_hours: age,
        sla_hours: sla,
        alerts_enabled: alertsOn,
        sla_breached: breached,
        failed_events_30d: evs.filter((e) =>
          e.event_type === "restore_failed" || e.event_type === "backup_failed",
        ).length,
        snapshot_days_30d: cadence.filter((b) => b.c > 0).length,
        cadence_30d: cadence,
        notes: override?.notes ?? null,
      };
    });

    return { tenants: rows, platform_sla_hours: platformSla };
  });

const UpsertSla = z.object({
  tenant_id: z.string().uuid(),
  snapshot_sla_hours: z.number().int().min(1).max(720),
  alerts_enabled: z.boolean(),
  notes: z.string().max(500).nullable().optional(),
});

export const upsertTenantBackupSla = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((v) => UpsertSla.parse(v))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("tenant_backup_slas")
      .upsert({
        tenant_id: data.tenant_id,
        snapshot_sla_hours: data.snapshot_sla_hours,
        alerts_enabled: data.alerts_enabled,
        notes: data.notes ?? null,
        updated_by: context.userId,
      });
    if (error) throw new Error(error.message);

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      action: "platform_backup.tenant_sla_updated",
      scope: "platform",
      resource_type: "tenant_backup_slas",
      resource_id: data.tenant_id,
      context: data,
    } as any);
    return { ok: true };
  });

const BulkUpsertSla = z.object({
  tenant_ids: z.array(z.string().uuid()).min(1).max(500),
  snapshot_sla_hours: z.number().int().min(1).max(720),
  alerts_enabled: z.boolean(),
  change_note: z.string().min(3).max(500),
});

export const bulkUpsertTenantBackupSlas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((v) => BulkUpsertSla.parse(v))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: affected, error } = await context.supabase.rpc("bulk_upsert_tenant_backup_slas", {
      _tenant_ids: data.tenant_ids,
      _snapshot_sla_hours: data.snapshot_sla_hours,
      _alerts_enabled: data.alerts_enabled,
      _change_note: data.change_note,
    });
    if (error) throw new Error(error.message);
    return { affected: affected as number };
  });


const RecordSnap = z.object({
  tenant_id: z.string().uuid(),
  taken_at: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
});

export const recordTenantSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((v) => RecordSnap.parse(v))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: profile } = await context.supabase
      .from("profiles").select("email").eq("id", context.userId).maybeSingle();
    const { error } = await context.supabase.from("platform_backup_events").insert({
      event_type: "snapshot_recorded",
      tenant_id: data.tenant_id,
      actor_id: context.userId,
      actor_email: profile?.email ?? null,
      notes: data.notes ?? null,
      created_at: data.taken_at ?? new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
