import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const RESOURCE_ACCESS_TYPES = [
  "data_source",
  "data_source_schedule",
  "db_connection",
  "inline_api_source",
  "erp_connection",
  "file_watcher",
  "aidp_template",
  "aidp_document",
  "reference_table",
  "data_prep_pipeline",
  "reconciliation",
  "collateral_schedule",
  "collateral_csa_agreement",
] as const;

export type ResourceAccessType = (typeof RESOURCE_ACCESS_TYPES)[number];
// Actor attribution is not yet captured for collateral schedules or CSA agreements.
export const RESOURCE_ACTOR_TYPES = [
  "data_source",
  "data_source_schedule",
  "db_connection",
  "inline_api_source",
  "erp_connection",
  "file_watcher",
  "aidp_template",
  "aidp_document",
  "reference_table",
  "data_prep_pipeline",
  "reconciliation",
] as const;

export type ResourceAccessSummary = {
  resource_type: ResourceAccessType;
  resource_id: string;
  public_id: string | null;
  access_state: "mapped" | "unmapped";
  business_unit_names: string[];
  business_unit_count: number;
  user_group_names: string[];
  user_group_count: number;
};

const Input = z.object({
  resource_type: z.enum(RESOURCE_ACCESS_TYPES),
  resource_ids: z.array(z.string().uuid()).min(1).max(100),
});

export const getResourceAccessSummaries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const requested = [...new Set(data.resource_ids)];
    if (requested.length > 100) return { available: false as const, rows: [] as ResourceAccessSummary[] };

    try {
      // The generated Supabase Database type may predate this source-only migration.
      const { data: rows, error } = await (context.supabase as any).rpc("get_data_resource_access_summary", {
        _resource_type: data.resource_type,
        _resource_ids: requested,
      });
      if (error || !Array.isArray(rows)) return { available: false as const, rows: [] as ResourceAccessSummary[] };

      const requestedSet = new Set(requested);
      const safeRows: ResourceAccessSummary[] = [];
      for (const row of rows as Array<Record<string, unknown>>) {
        if (row.resource_type !== data.resource_type || typeof row.resource_id !== "string" || !requestedSet.has(row.resource_id)) continue;
        if (row.access_state !== "mapped" && row.access_state !== "unmapped") continue;
        safeRows.push({
          resource_type: data.resource_type,
          resource_id: row.resource_id,
          public_id: typeof row.public_id === "string" && row.public_id.trim() ? row.public_id : null,
          access_state: row.access_state,
          business_unit_names: Array.isArray(row.business_unit_names) ? row.business_unit_names.filter((name): name is string => typeof name === "string") : [],
          business_unit_count: Number.isInteger(row.business_unit_count) ? Number(row.business_unit_count) : 0,
          user_group_names: Array.isArray(row.user_group_names) ? row.user_group_names.filter((name): name is string => typeof name === "string") : [],
          user_group_count: Number.isInteger(row.user_group_count) ? Number(row.user_group_count) : 0,
        });
      }
      return { available: true as const, rows: safeRows };
    } catch {
      // An unapplied migration, provider outage, or policy rejection is unavailable data,
      // never evidence that a resource has no mappings.
      return { available: false as const, rows: [] as ResourceAccessSummary[] };
    }
  });

const mappingReason = z.string().trim().min(3).max(1000);
const ownerBuIds = z.array(z.string().uuid()).min(1).max(100).transform((values) => [...new Set(values)]);
const groupIds = z.array(z.string().uuid()).max(100).transform((values) => [...new Set(values)]);
const collateralScheduleAccessInput = z.object({
  tenant_id: z.string().uuid(),
  schedule_id: z.string().uuid(),
  owner_bu_ids: ownerBuIds,
  group_ids: groupIds,
  reason: mappingReason,
});
const collateralScheduleActionInput = z.object({
  tenant_id: z.string().uuid(),
  schedule_id: z.string().uuid(),
  bu_id: z.string().uuid(),
  group_id: z.string().uuid(),
  action: z.enum(["view", "ingest", "run", "edit"]),
  reason: mappingReason,
});
const collateralScheduleRevokeInput = z.object({
  tenant_id: z.string().uuid(),
  schedule_id: z.string().uuid(),
  grant_id: z.string().uuid(),
  reason: mappingReason,
});

type MappingContext = { supabase: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; status?: number } | null }> } };

function throwSafeMappingError(error: { code?: string; status?: number } | null): never {
  const status = error?.status ?? (error?.code === "42501" ? 403 : error?.code === "22023" ? 400 : 503);
  const message = status === 403
    ? "You are not authorized to change this resource mapping."
    : status === 400
      ? "The resource mapping request is invalid."
      : "Resource access is temporarily unavailable. Refresh and retry.";
  throw Object.assign(new Error(message), { status });
}

export async function saveCollateralScheduleAccessHandler({
  data,
  context,
}: {
  data: unknown;
  context: MappingContext;
}) {
  const input = collateralScheduleAccessInput.parse(data);
  const { data: result, error } = await context.supabase.rpc("save_typed_data_resource_access", {
    _tenant_id: input.tenant_id,
    _resource_type: "collateral_schedule",
    _resource_id: input.schedule_id,
    _owner_bu_ids: input.owner_bu_ids,
    _group_ids: input.group_ids,
    _reason: input.reason,
  });
  if (error || result == null) throwSafeMappingError(error);
  return result;
}

export const saveCollateralScheduleAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => collateralScheduleAccessInput.parse(input))
  .handler(({ data, context }) => saveCollateralScheduleAccessHandler({ data, context: context as unknown as MappingContext }));

export async function grantCollateralScheduleGroupActionHandler({
  data,
  context,
}: {
  data: unknown;
  context: MappingContext;
}) {
  const input = collateralScheduleActionInput.parse(data);
  const { data: result, error } = await context.supabase.rpc("grant_collateral_schedule_group_action", {
    _tenant_id: input.tenant_id,
    _schedule_id: input.schedule_id,
    _bu_id: input.bu_id,
    _group_id: input.group_id,
    _action: input.action,
    _reason: input.reason,
  });
  if (error || typeof result !== "string") throwSafeMappingError(error);
  return result;
}

export const grantCollateralScheduleGroupAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => collateralScheduleActionInput.parse(input))
  .handler(({ data, context }) => grantCollateralScheduleGroupActionHandler({ data, context: context as unknown as MappingContext }));

export async function revokeCollateralScheduleGroupActionHandler({
  data,
  context,
}: {
  data: unknown;
  context: MappingContext;
}) {
  const input = collateralScheduleRevokeInput.parse(data);
  const { data: result, error } = await context.supabase.rpc("revoke_collateral_schedule_group_action", {
    _tenant_id: input.tenant_id,
    _schedule_id: input.schedule_id,
    _grant_id: input.grant_id,
    _reason: input.reason,
  });
  if (error || result !== true) throwSafeMappingError(error);
  return result;
}

export const revokeCollateralScheduleGroupAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => collateralScheduleRevokeInput.parse(input))
  .handler(({ data, context }) => revokeCollateralScheduleGroupActionHandler({ data, context: context as unknown as MappingContext }));
