/**
 * Domain Console — Data Quality & Lineage drill-down + audit fns.
 *
 * These server fns are ABAC-aware:
 *  • Sample values in dq_results are inspected against enabled ABAC
 *    predicates on the caller. Sample keys whose `attribute` matches a
 *    predicate the caller is NOT satisfied for are masked with `***`.
 *  • Every drill-down write a tenant-scoped audit_log entry so the
 *    per-rule / per-lineage trail is queryable end-to-end.
 *  • Reads are already tenant-scoped by RLS on the underlying tables.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const tid = z.string().uuid();

type Predicate = {
  id: string;
  permission_id: string;
  attribute: string;
  operator: "in" | "not_in" | "equals";
  values: string[];
  enabled: boolean;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SampleRow = Record<string, any>;

async function loadAbacGuard(
  supabase: any,
  tenant_id: string,
  userId: string,
  permission_id: string,
) {
  const { data: predRows } = await supabase
    .from("rbac_abac_predicates")
    .select("id,permission_id,attribute,operator,values,enabled")
    .eq("tenant_id", tenant_id)
    .eq("enabled", true)
    .eq("permission_id", permission_id);
  const preds = (predRows ?? []) as Predicate[];

  // Cache checks by attribute value to avoid N RPCs.
  const cache = new Map<string, boolean>();
  async function isAllowed(attribute: string, value: unknown): Promise<boolean> {
    const key = `${attribute}::${String(value)}`;
    if (cache.has(key)) return cache.get(key)!;
    const attrs: Record<string, unknown> = { [attribute]: value };
    const { data: allowed, error } = await supabase.rpc("has_permission_abac", {
      _user_id: userId,
      _permission: permission_id,
      _tenant_id: tenant_id,
      _attributes: attrs as never,
    } as never);
    const ok = !error && !!allowed;
    cache.set(key, ok);
    return ok;
  }

  return { preds, isAllowed };
}

function maskSampleValue(v: unknown): string {
  if (v == null) return "∅";
  const s = String(v);
  if (s.length <= 2) return "**";
  return `${s.slice(0, 1)}${"*".repeat(Math.min(6, s.length - 2))}${s.slice(-1)}`;
}

async function applyAbacMask(
  samples: SampleRow[],
  guard: { preds: Predicate[]; isAllowed: (a: string, v: unknown) => Promise<boolean> },
): Promise<{ rows: SampleRow[]; maskedFields: string[]; maskedCount: number }> {
  const attrs = new Set(guard.preds.map((p) => p.attribute));
  if (attrs.size === 0) return { rows: samples, maskedFields: [], maskedCount: 0 };
  let maskedCount = 0;
  const maskedFields = new Set<string>();
  const rows: SampleRow[] = [];
  for (const row of samples) {
    const next: SampleRow = { ...row };
    for (const key of Object.keys(row)) {
      if (!attrs.has(key)) continue;
      const allowed = await guard.isAllowed(key, row[key]);
      if (!allowed) {
        next[key] = maskSampleValue(row[key]);
        maskedFields.add(key);
        maskedCount++;
      }
    }
    rows.push(next);
  }
  return { rows, maskedFields: Array.from(maskedFields), maskedCount };
}

/* ============================================================
 * DQ violation drill-down
 * ==========================================================*/
export const listDqRuleViolations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: tid,
      dq_rule_id: z.string().uuid(),
      limit: z.number().int().min(1).max(50).default(20),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rule, error: rerr } = await context.supabase
      .from("dq_rules")
      .select("id,name,target_schema,target_table,expression,severity,enabled")
      .eq("id", data.dq_rule_id)
      .eq("tenant_id", data.tenant_id)
      .maybeSingle();
    if (rerr) throw new Error(rerr.message);
    if (!rule) throw new Error("Rule not found or not visible under RLS.");

    const { data: rows, error } = await context.supabase
      .from("dq_results")
      .select("id,run_at,score,violations,severity,samples")
      .eq("tenant_id", data.tenant_id)
      .eq("dq_rule_id", data.dq_rule_id)
      .order("run_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);

    const guard = await loadAbacGuard(
      context.supabase,
      data.tenant_id,
      context.userId,
      "dq.samples.view",
    );

    const results = [];
    let totalMasked = 0;
    const maskedFieldsAll = new Set<string>();
    for (const r of rows ?? []) {
      const samples = Array.isArray(r.samples) ? (r.samples as SampleRow[]) : [];
      const { rows: masked, maskedFields, maskedCount } = await applyAbacMask(samples, guard);
      totalMasked += maskedCount;
      maskedFields.forEach((f) => maskedFieldsAll.add(f));
      results.push({
        id: r.id,
        run_at: r.run_at,
        score: r.score,
        violations: r.violations,
        severity: r.severity,
        samples: masked,
      });
    }

    // ABAC-aware audit trail entry
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: "dq.samples.view",
      resource_type: "dq_rules",
      resource_id: data.dq_rule_id,
      context: {
        rule_name: rule.name,
        table: `${rule.target_schema}.${rule.target_table}`,
        runs_returned: results.length,
        masked_cells: totalMasked,
        masked_fields: Array.from(maskedFieldsAll),
        abac_predicates_evaluated: guard.preds.length,
      },
    } as never);

    return {
      rule,
      results,
      abac: {
        predicates_evaluated: guard.preds.length,
        masked_cells: totalMasked,
        masked_fields: Array.from(maskedFieldsAll),
      },
    };
  });

/* ============================================================
 * Lineage drill-down for a single node (kind:ref)
 * ==========================================================*/
export const listLineageForNode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: tid,
      kind: z.string().min(1).max(60),
      ref: z.string().min(1).max(200),
      limit: z.number().int().min(1).max(500).default(200),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: upstream, error: uerr } = await context.supabase
      .from("data_lineage_edges")
      .select("id,source_kind,source_ref,source_label,target_kind,target_ref,target_label,transform,evidence_hash,recorded_at")
      .eq("tenant_id", data.tenant_id)
      .eq("target_kind", data.kind)
      .eq("target_ref", data.ref)
      .order("recorded_at", { ascending: false })
      .limit(data.limit);
    if (uerr) throw new Error(uerr.message);

    const { data: downstream, error: derr } = await context.supabase
      .from("data_lineage_edges")
      .select("id,source_kind,source_ref,source_label,target_kind,target_ref,target_label,transform,evidence_hash,recorded_at")
      .eq("tenant_id", data.tenant_id)
      .eq("source_kind", data.kind)
      .eq("source_ref", data.ref)
      .order("recorded_at", { ascending: false })
      .limit(data.limit);
    if (derr) throw new Error(derr.message);

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: "lineage.node.view",
      resource_type: "data_lineage_edges",
      resource_id: `${data.kind}:${data.ref}`,
      context: {
        upstream: upstream?.length ?? 0,
        downstream: downstream?.length ?? 0,
      },
    } as never);

    return {
      node: { kind: data.kind, ref: data.ref },
      upstream: upstream ?? [],
      downstream: downstream ?? [],
    };
  });

/* ============================================================
 * Lineage drill-down for a kind→kind pair (used from the flow map)
 * ==========================================================*/
export const listLineageForKindPair = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: tid,
      source_kind: z.string().min(1).max(60),
      target_kind: z.string().min(1).max(60),
      limit: z.number().int().min(1).max(500).default(100),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("data_lineage_edges")
      .select("id,source_kind,source_ref,source_label,target_kind,target_ref,target_label,transform,evidence_hash,recorded_at,recorded_by")
      .eq("tenant_id", data.tenant_id)
      .eq("source_kind", data.source_kind)
      .eq("target_kind", data.target_kind)
      .order("recorded_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: "lineage.pair.view",
      resource_type: "data_lineage_edges",
      resource_id: `${data.source_kind}→${data.target_kind}`,
      context: { edges_returned: rows?.length ?? 0 },
    } as never);

    return { edges: rows ?? [] };
  });

/* ============================================================
 * Domain audit trail — DQ + lineage + ABAC actions in one feed
 * ==========================================================*/
const DOMAIN_ACTIONS = [
  "dq.samples.view",
  "dq.rule.upsert",
  "lineage.node.view",
  "lineage.pair.view",
  "rbac.abac.create",
  "rbac.abac.update",
  "rbac.abac.delete",
  "access.denied",
] as const;

export const listDomainAuditTrail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: tid,
      resource_type: z.string().max(120).optional(),
      resource_id: z.string().max(200).optional(),
      actions: z.array(z.string()).max(20).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const actions = data.actions?.length ? data.actions : Array.from(DOMAIN_ACTIONS);
    let q = context.supabase
      .from("audit_log")
      .select("id,occurred_at,actor_user_id,actor_email,action,resource_type,resource_id,context")
      .eq("tenant_id", data.tenant_id)
      .in("action", actions as never)
      .order("occurred_at", { ascending: false })
      .limit(data.limit);
    if (data.resource_type) q = q.eq("resource_type", data.resource_type);
    if (data.resource_id) q = q.eq("resource_id", data.resource_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
