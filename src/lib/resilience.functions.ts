import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- Resilience tier ----------
export const getResilienceTier = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("tenant_resilience_tiers")
      .select("*")
      .eq("tenant_id", data.tenantId)
      .maybeSingle();
    if (error) throw error;
    return row;
  });

export const upsertResilienceTier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator(
    (d: {
      tenantId: string;
      tier: "standard" | "premium" | "platinum" | "mission_critical";
      rpoSeconds: number;
      rtoSeconds: number;
      primaryRegion: string;
      secondaryRegion?: string | null;
      activeActive: boolean;
      failoverStrategy: "manual" | "assisted" | "automatic";
      notes?: string | null;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("tenant_resilience_tiers")
      .upsert(
        {
          tenant_id: data.tenantId,
          tier: data.tier,
          rpo_seconds: data.rpoSeconds,
          rto_seconds: data.rtoSeconds,
          primary_region: data.primaryRegion,
          secondary_region: data.secondaryRegion ?? null,
          active_active: data.activeActive,
          failover_strategy: data.failoverStrategy,
          notes: data.notes ?? null,
        },
        { onConflict: "tenant_id" },
      );
    if (error) throw error;
    return { ok: true };
  });

// ---------- DR drills ----------
export const listDrDrills = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId?: string | null }) => d)
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("dr_drills")
      .select("*")
      .order("scheduled_at", { ascending: false })
      .limit(100);
    if (data.tenantId) q = q.eq("tenant_id", data.tenantId);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

export const createDrDrill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator(
    (d: {
      tenantId?: string | null;
      drillType:
        | "failover"
        | "chaos"
        | "backup_restore"
        | "tabletop"
        | "region_evac"
        | "data_corruption";
      title: string;
      description?: string | null;
      scheduledAt: string;
      targetRpoSeconds?: number | null;
      targetRtoSeconds?: number | null;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("dr_drills")
      .insert({
        tenant_id: data.tenantId ?? null,
        drill_type: data.drillType,
        title: data.title,
        description: data.description ?? null,
        scheduled_at: data.scheduledAt,
        target_rpo_seconds: data.targetRpoSeconds ?? null,
        target_rto_seconds: data.targetRtoSeconds ?? null,
        conducted_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    return row;
  });

export const recordDrillEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator(
    (d: {
      drillId: string;
      status: "in_progress" | "passed" | "failed" | "cancelled";
      observedRpoSeconds?: number | null;
      observedRtoSeconds?: number | null;
      evidenceUrl?: string | null;
      evidenceSha256?: string | null;
      findings?: string | null;
      remediation?: string | null;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const patch: {
      status: typeof data.status;
      observed_rpo_seconds: number | null;
      observed_rto_seconds: number | null;
      evidence_url: string | null;
      evidence_sha256: string | null;
      findings: string | null;
      remediation: string | null;
      started_at?: string;
      completed_at?: string;
    } = {
      status: data.status,
      observed_rpo_seconds: data.observedRpoSeconds ?? null,
      observed_rto_seconds: data.observedRtoSeconds ?? null,
      evidence_url: data.evidenceUrl ?? null,
      evidence_sha256: data.evidenceSha256 ?? null,
      findings: data.findings ?? null,
      remediation: data.remediation ?? null,
    };
    if (data.status === "in_progress") patch.started_at = new Date().toISOString();
    if (data.status === "passed" || data.status === "failed" || data.status === "cancelled") {
      patch.completed_at = new Date().toISOString();
    }
    const { error } = await context.supabase
      .from("dr_drills")
      .update(patch)
      .eq("id", data.drillId);
    if (error) throw error;
    return { ok: true };
  });

// ---------- Maintenance windows ----------
export const listMaintenanceWindows = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId?: string | null }) => d)
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("maintenance_windows")
      .select("*")
      .order("starts_at", { ascending: false })
      .limit(100);
    if (data.tenantId) {
      q = q.or(`tenant_id.eq.${data.tenantId},scope.eq.platform`);
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

export const upsertMaintenanceWindow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator(
    (d: {
      id?: string | null;
      tenantId?: string | null;
      scope: "platform" | "tenant" | "region" | "component";
      region?: string | null;
      component?: string | null;
      title: string;
      description?: string | null;
      startsAt: string;
      endsAt: string;
      impact: "none" | "minor" | "major" | "full_outage";
      status: "scheduled" | "in_progress" | "completed" | "cancelled";
      notifyCustomers: boolean;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const payload = {
      tenant_id: data.tenantId ?? null,
      scope: data.scope,
      region: data.region ?? null,
      component: data.component ?? null,
      title: data.title,
      description: data.description ?? null,
      starts_at: data.startsAt,
      ends_at: data.endsAt,
      impact: data.impact,
      status: data.status,
      notify_customers: data.notifyCustomers,
      created_by: context.userId,
    };
    if (data.id) {
      const { error } = await context.supabase
        .from("maintenance_windows")
        .update(payload)
        .eq("id", data.id);
      if (error) throw error;
      return { id: data.id };
    }
    const { data: row, error } = await context.supabase
      .from("maintenance_windows")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw error;
    return row;
  });

// ---------- Change-freeze windows ----------
export const listChangeFreezes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId?: string | null }) => d)
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("change_freeze_windows")
      .select("*")
      .order("starts_at", { ascending: false })
      .limit(100);
    if (data.tenantId) {
      q = q.or(`tenant_id.eq.${data.tenantId},scope.eq.platform`);
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

export const upsertChangeFreeze = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator(
    (d: {
      id?: string | null;
      tenantId?: string | null;
      scope: "platform" | "tenant";
      reason: string;
      startsAt: string;
      endsAt: string;
      blocksDeploys: boolean;
      blocksConfigChanges: boolean;
      blocksSchemaChanges: boolean;
      breakGlassRole?: string | null;
      active: boolean;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const payload = {
      tenant_id: data.tenantId ?? null,
      scope: data.scope,
      reason: data.reason,
      starts_at: data.startsAt,
      ends_at: data.endsAt,
      blocks_deploys: data.blocksDeploys,
      blocks_config_changes: data.blocksConfigChanges,
      blocks_schema_changes: data.blocksSchemaChanges,
      break_glass_role: data.breakGlassRole ?? null,
      active: data.active,
      created_by: context.userId,
    };
    if (data.id) {
      const { error } = await context.supabase
        .from("change_freeze_windows")
        .update(payload)
        .eq("id", data.id);
      if (error) throw error;
      return { id: data.id };
    }
    const { data: row, error } = await context.supabase
      .from("change_freeze_windows")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw error;
    return row;
  });

// ---------- Per-tenant SLO snapshots ----------
export const listTenantSloSnapshots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId: string; hours?: number }) => d)
  .handler(async ({ data, context }) => {
    const since = new Date(
      Date.now() - (data.hours ?? 24) * 3600 * 1000,
    ).toISOString();
    const { data: rows, error } = await context.supabase
      .from("tenant_slo_snapshots")
      .select("*")
      .eq("tenant_id", data.tenantId)
      .gte("bucket_start", since)
      .order("bucket_start", { ascending: true });
    if (error) throw error;
    return rows ?? [];
  });
