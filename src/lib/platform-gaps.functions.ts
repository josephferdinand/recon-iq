import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/rbac-guards.server";
import { z } from "zod";
import {
  schemaDriftDetector,
  policyAuditor,
  crossReconIntelligence,
} from "@/lib/copilot-tools.server";

async function assertPlatformAdmin(ctx: any) {
  await requirePlatformAdmin(ctx, { fnName: "platform-gaps" });
}

/* ─────────── P11: Migration imports (cross-tenant) ─────────── */

export const listMigrationImports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        tenant_id: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(500).default(100),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    let q = context.supabase
      .from("migration_imports")
      .select(
        "id, tenant_id, source_system, file_name, status, definitions_found, definitions_imported, mapping_report, error_message, created_at, updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const tenantIds = Array.from(new Set((rows ?? []).map((r: any) => r.tenant_id)));
    let tenantMap = new Map<string, { name: string; slug: string }>();
    if (tenantIds.length) {
      const { data: tenants } = await context.supabase
        .from("tenants")
        .select("id, name, slug")
        .in("id", tenantIds);
      tenantMap = new Map(
        (tenants ?? []).map((t: any) => [t.id, { name: t.name, slug: t.slug }]),
      );
    }
    return (rows ?? []).map((r: any) => {
      const report = r.mapping_report ?? {};
      const mapped = Array.isArray(report?.mapped_concepts) ? report.mapped_concepts : [];
      const avgConf =
        mapped.length > 0
          ? mapped.reduce((a: number, m: any) => a + Number(m?.confidence ?? 0), 0) /
            mapped.length
          : null;
      return {
        ...r,
        tenant_name: tenantMap.get(r.tenant_id)?.name ?? "—",
        tenant_slug: tenantMap.get(r.tenant_id)?.slug ?? null,
        confidence_score: avgConf,
        records_failed: Math.max(
          0,
          (Number(r.definitions_found) || 0) - (Number(r.definitions_imported) || 0),
        ),
      };
    });
  });

export const reRunMigrationImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { data: row, error } = await context.supabase
      .from("migration_imports")
      .update({ status: "queued", error_message: null, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .select("id, tenant_id, source_system")
      .single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: row.tenant_id,
      scope: "platform",
      action: "migration.import.rerun",
      resource_type: "migration_imports",
      resource_id: row.id,
      context: { source: row.source_system },
    } as any);
    return { ok: true };
  });

/* ─────────── P15: Benchmarks (platform-wide recon perf) ─────────── */

export const getPlatformReconPerformance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        tenant_id: z.string().uuid().optional(),
        window_days: z.number().int().min(1).max(90).default(7),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const since = new Date(Date.now() - data.window_days * 86400e3).toISOString();

    let q = context.supabase
      .from("recon_runs")
      .select("id, tenant_id, definition_id, status, started_at, completed_at")
      .gte("started_at", since)
      .not("completed_at", "is", null)
      .limit(5000);
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    const { data: runs, error } = await q;
    if (error) throw new Error(error.message);

    const durations: number[] = [];
    const perDef = new Map<string, number[]>();
    const perDay = new Map<string, number[]>();
    for (const r of (runs ?? []) as any[]) {
      if (!r.started_at || !r.completed_at) continue;
      const d = Date.parse(r.completed_at) - Date.parse(r.started_at);
      if (!Number.isFinite(d) || d < 0) continue;
      durations.push(d);
      const arr = perDef.get(r.definition_id) ?? [];
      arr.push(d);
      perDef.set(r.definition_id, arr);
      const day = r.started_at.slice(0, 10);
      const dayArr = perDay.get(day) ?? [];
      dayArr.push(d);
      perDay.set(day, dayArr);
    }

    const percentile = (arr: number[], p: number) => {
      if (arr.length === 0) return 0;
      const s = [...arr].sort((a, b) => a - b);
      const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
      return s[idx];
    };

    const defIds = Array.from(perDef.keys());
    let defNames = new Map<string, { name: string; tenant_id: string }>();
    if (defIds.length) {
      const { data: defs } = await context.supabase
        .from("recon_definitions")
        .select("id, name, tenant_id")
        .in("id", defIds);
      defNames = new Map(
        (defs ?? []).map((d: any) => [d.id, { name: d.name, tenant_id: d.tenant_id }]),
      );
    }
    const slowest = Array.from(perDef.entries())
      .map(([id, arr]) => ({
        definition_id: id,
        name: defNames.get(id)?.name ?? id.slice(0, 8),
        tenant_id: defNames.get(id)?.tenant_id ?? null,
        run_count: arr.length,
        p95_ms: percentile(arr, 95),
        p50_ms: percentile(arr, 50),
      }))
      .filter((d) => d.run_count >= 2)
      .sort((a, b) => b.p95_ms - a.p95_ms)
      .slice(0, 5);

    const trend = Array.from(perDay.entries())
      .map(([date, arr]) => ({
        date,
        run_count: arr.length,
        p50_ms: percentile(arr, 50),
        p95_ms: percentile(arr, 95),
      }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    return {
      window_days: data.window_days,
      total_runs: durations.length,
      p50_ms: percentile(durations, 50),
      p95_ms: percentile(durations, 95),
      p99_ms: percentile(durations, 99),
      slowest_definitions: slowest,
      daily_trend: trend,
    };
  });

export const listStaticBenchmarks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const { data } = await context.supabase
      .from("platform_benchmarks")
      .select("*")
      .order("metric");
    return data ?? [];
  });

/* ─────────── P20: Schema drift unified ─────────── */

export const listAllSchemaDrift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ limit: z.number().int().min(1).max(200).default(50) }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    const { data: tenants } = await context.supabase
      .from("tenants")
      .select("id, name, slug")
      .limit(data.limit);
    const results = await Promise.all(
      (tenants ?? []).map(async (t: any) => {
        try {
          const drift = await schemaDriftDetector(context.supabase as any, { tenantId: t.id });
          const changeCount =
            (drift.added?.length ?? 0) +
            (drift.removed?.length ?? 0) +
            (drift.modified?.length ?? 0);
          return {
            tenant_id: t.id,
            tenant_name: t.name,
            tenant_slug: t.slug,
            status: changeCount === 0 ? "clean" : "drifted",
            change_count: changeCount,
            added: drift.added,
            removed: drift.removed,
            modified: drift.modified.map((m) => ({
              key: m.key,
              field: m.field,
              before: String(m.before ?? ""),
              after: String(m.after ?? ""),
            })),
            first_drifted_at: drift.first_drifted_at,
          };
        } catch {
          return {
            tenant_id: t.id,
            tenant_name: t.name,
            tenant_slug: t.slug,
            status: "unknown",
            change_count: 0,
            added: [],
            removed: [],
            modified: [],
            first_drifted_at: null,
          };
        }
      }),
    );
    return results.sort((a, b) => b.change_count - a.change_count);
  });

export const bulkReBaselineSchemas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_ids: z.array(z.string().uuid()).min(1).max(50) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    let baselined = 0;
    for (const tenantId of data.tenant_ids) {
      const { data: defs } = await context.supabase
        .from("recon_definitions")
        .select("id, tenant_id, name, status, version, sides, rules")
        .eq("tenant_id", tenantId);
      for (const def of (defs ?? []) as any[]) {
        const { data: last } = await context.supabase
          .from("recon_definition_versions")
          .select("version")
          .eq("recon_definition_id", def.id)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();
        const next = ((last as any)?.version ?? 0) + 1;
        await context.supabase.from("recon_definition_versions").insert({
          tenant_id: tenantId,
          recon_definition_id: def.id,
          version: next,
          snapshot_json: def,
          created_by: context.userId,
          message: "Platform re-baseline",
        } as any);
        baselined++;
      }
      await context.supabase.from("audit_log").insert({
        actor_user_id: context.userId,
        tenant_id: tenantId,
        scope: "platform",
        action: "schema.rebaseline",
        resource_type: "recon_definitions",
        resource_id: null,
        context: { definitions: (defs ?? []).length },
      } as any);
    }
    return { ok: true, baselined };
  });

/* ─────────── P22: Policy auditor unified ─────────── */

export const getPolicyAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context);
    const result = await policyAuditor(context.supabase as any);
    const tenantIds = Array.from(
      new Set(
        [
          ...result.overdue_byok_rotation,
          ...result.below_floor_retention,
          ...result.expiring_step_up_grants,
          ...result.missing_backups_24h,
        ].map((r: any) => r.tenant_id),
      ),
    );
    let tenantMap = new Map<string, { name: string; slug: string }>();
    if (tenantIds.length) {
      const { data: tenants } = await context.supabase
        .from("tenants")
        .select("id, name, slug")
        .in("id", tenantIds);
      tenantMap = new Map(
        (tenants ?? []).map((t: any) => [t.id, { name: t.name, slug: t.slug }]),
      );
    }
    const decorate = <T extends { tenant_id: string }>(rows: T[]) =>
      rows.map((r) => ({
        ...r,
        tenant_name: tenantMap.get(r.tenant_id)?.name ?? r.tenant_id.slice(0, 8),
        tenant_slug: tenantMap.get(r.tenant_id)?.slug ?? null,
      }));
    return {
      overdue_byok_rotation: decorate(result.overdue_byok_rotation),
      below_floor_retention: decorate(result.below_floor_retention),
      expiring_step_up_grants: decorate(result.expiring_step_up_grants),
      missing_backups_24h: decorate(result.missing_backups_24h),
    };
  });

/* ─────────── P23: Cross-recon intelligence ─────────── */

export const getCrossReconIntelligence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context);
    return crossReconIntelligence(context.supabase as any, { tenantId: data.tenant_id });
  });
