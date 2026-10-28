/**
 * useKpi(id) — Phase 2 Medium-Term.
 *
 * Reads a KPI definition from `KPI_REGISTRY` and executes it under the
 * caller's Supabase client. Every dashboard tile that reads a named KPI
 * should go through this hook so we can retire bespoke queries and hit
 * the KPI registry consistently.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { KPI_REGISTRY, type KpiId, type KpiValue } from "@/lib/kpi-registry";

export function useKpi(id: KpiId | string, opts?: { tenantId?: string; enabled?: boolean }) {
  const def = (KPI_REGISTRY as Record<string, (typeof KPI_REGISTRY)[KpiId]>)[id];
  return useQuery<KpiValue>({
    queryKey: ["kpi", id, opts?.tenantId ?? null],
    enabled: !!def && (opts?.enabled ?? true),
    staleTime: 30_000,
    queryFn: async () => {
      if (!def) return { value: null };
      return def.read(supabase as never, opts);
    },
  });
}
