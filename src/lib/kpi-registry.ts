/**
 * KPI Registry — Phase 2 Medium-Term (Item M3).
 *
 * Single source of truth for named KPIs used across dashboards. Each entry
 * declares its title, unit, format, and a `read` function that pulls the
 * value from Supabase (or an in-memory analytics view) under caller RLS.
 *
 * Downstream dashboards read KPIs through `useKpi(id)` (see
 * `src/hooks/use-kpi.ts`), so retrofitting a dashboard means swapping
 * bespoke queries for one hook call per tile.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type KpiValue = { value: number | null; label?: string; trend?: "up" | "down" | "flat" };

export interface KpiDefinition {
  id: string;
  title: string;
  domain: "tenancy" | "ai" | "recon" | "marketplace" | "governance" | "reliability" | "cost";
  unit: "count" | "currency" | "percent" | "ms" | "score";
  read: (supabase: SupabaseClient, opts?: { tenantId?: string }) => Promise<KpiValue>;
}

const scalar = async (
  supabase: SupabaseClient,
  table: string,
  filter?: (q: any) => any,
): Promise<KpiValue> => {
  let q: any = supabase.from(table).select("id", { count: "exact", head: true });
  if (filter) q = filter(q);
  const { count, error } = await q;
  if (error) return { value: null };
  return { value: count ?? 0 };
};

export const KPI_REGISTRY: Record<string, KpiDefinition> = {
  "tenancy.active_tenants": {
    id: "tenancy.active_tenants",
    title: "Active tenants",
    domain: "tenancy",
    unit: "count",
    read: (s) => scalar(s, "tenants"),
  },
  "marketplace.total_installs": {
    id: "marketplace.total_installs",
    title: "Marketplace installs",
    domain: "marketplace",
    unit: "count",
    read: (s) => scalar(s, "marketplace_installs"),
  },
  "marketplace.published_listings": {
    id: "marketplace.published_listings",
    title: "Published listings",
    domain: "marketplace",
    unit: "count",
    read: (s) => scalar(s, "marketplace_listings", (q) => q.eq("status", "published")),
  },
  "recon.active_exceptions": {
    id: "recon.active_exceptions",
    title: "Active recon exceptions",
    domain: "recon",
    unit: "count",
    read: (s, o) =>
      scalar(s, "recon_exceptions", (q) => {
        let x = q.neq("status", "resolved");
        if (o?.tenantId) x = x.eq("tenant_id", o.tenantId);
        return x;
      }),
  },
  "ai.usage_events_24h": {
    id: "ai.usage_events_24h",
    title: "AI events (24h)",
    domain: "ai",
    unit: "count",
    read: (s) =>
      scalar(s, "ai_usage_events", (q) =>
        q.gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
      ),
  },
  "governance.hitl_queue_open": {
    id: "governance.hitl_queue_open",
    title: "HITL queue (open)",
    domain: "governance",
    unit: "count",
    read: (s) => scalar(s, "ai_governance_hitl_queue", (q) => q.eq("status", "pending")),
  },
  "reliability.dr_drills_last_90d": {
    id: "reliability.dr_drills_last_90d",
    title: "DR drills (90d)",
    domain: "reliability",
    unit: "count",
    read: (s) =>
      scalar(s, "dr_drills", (q) =>
        q.gte("created_at", new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString()),
      ),
  },
} as const;

export type KpiId = keyof typeof KPI_REGISTRY;

export function listKpis(domain?: KpiDefinition["domain"]): KpiDefinition[] {
  const all = Object.values(KPI_REGISTRY);
  return domain ? all.filter((k) => k.domain === domain) : all;
}
