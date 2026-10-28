import type { ResourceAccessSummary, ResourceAccessType } from "@/lib/resource-access-summaries.functions";

type MappingResponse = { available: boolean; rows: ResourceAccessSummary[] };
const unavailable = (): MappingResponse => ({ available: false, rows: [] });

export function resourceMappingDisplayKey(tenantId: string, actorId: string | null, type: ResourceAccessType, ids: string[]) {
  return ["resource-access-summary", tenantId, type, actorId, [...new Set(ids)].sort()] as const;
}

/** Metadata is display-only. Missing/denied rows never establish access or zero mappings. */
export function currentResourceMappingDisplay(
  type: ResourceAccessType,
  ids: string[],
  state: { actorId: string | null; isSuccess: boolean; isFetching: boolean; data?: MappingResponse },
): MappingResponse {
  if (!state.actorId || !state.isSuccess || state.isFetching || state.data?.available !== true) return unavailable();
  const requested = new Set(ids);
  if (!requested.size || requested.size > 100) return unavailable();
  const seen = new Set<string>();
  const rows: ResourceAccessSummary[] = [];
  for (const row of state.data.rows) {
    if (row.resource_type !== type || !requested.has(row.resource_id)) continue;
    // The RPC returns full name lists. Inconsistent counts are unavailable metadata, not "None".
    const validNames = (names: string[], count: number) => Array.isArray(names) &&
      names.every(name => typeof name === "string" && name.trim().length > 0) &&
      Number.isInteger(count) && count >= 0 && count === names.length;
    if (seen.has(row.resource_id) || !["mapped", "unmapped"].includes(row.access_state) ||
      !validNames(row.business_unit_names, row.business_unit_count) || !validNames(row.user_group_names, row.user_group_count) ||
      (row.access_state === "unmapped" && (row.business_unit_count !== 0 || row.user_group_count !== 0))) return unavailable();
    seen.add(row.resource_id);
    rows.push(row);
  }
  return { available: true, rows };
}
