import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { RESOURCE_ACTOR_TYPES, type ResourceAccessType } from "@/lib/resource-access-summaries.functions";

const ActorStatus = z.enum(["known", "inactive", "removed", "unattributed", "unknown"]);

export type ResourceActorSummary = {
  resource_type: ResourceAccessType;
  resource_id: string;
  created_by_label: string;
  created_by_status: z.infer<typeof ActorStatus>;
  updated_by_label: string;
  updated_by_status: z.infer<typeof ActorStatus>;
};

const Input = z.object({
  resource_type: z.enum(RESOURCE_ACTOR_TYPES),
  resource_ids: z.array(z.string().uuid()).min(1).max(100),
});

function safeActorLabel(value: unknown, status: z.infer<typeof ActorStatus>) {
  if (status === "inactive") return "Inactive user";
  if (status === "removed") return "Former member";
  if (status === "unattributed") return "Unattributed";
  if (status === "unknown") return "Unknown";
  const name = typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/gu, "").trim().slice(0, 120) : "";
  if (/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/u.test(name) || /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu.test(name)) return "Unknown";
  return name || "Unknown";
}

export function normalizeResourceActorSummaries(
  rows: unknown,
  resourceType: ResourceAccessType,
  requestedIds: readonly string[],
): ResourceActorSummary[] {
  if (!Array.isArray(rows)) return [];
  const requested = new Set(requestedIds);
  const seen = new Set<string>();
  const safe: ResourceActorSummary[] = [];
  for (const candidate of rows) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const row = candidate as Record<string, unknown>;
    if (row.resource_type !== resourceType || typeof row.resource_id !== "string" || !requested.has(row.resource_id) || seen.has(row.resource_id)) continue;
    const createdStatus = ActorStatus.safeParse(row.created_by_status);
    const updatedStatus = ActorStatus.safeParse(row.updated_by_status);
    if (!createdStatus.success || !updatedStatus.success) continue;
    const createdLabel = safeActorLabel(row.created_by_label, createdStatus.data);
    const updatedLabel = safeActorLabel(row.updated_by_label, updatedStatus.data);
    safe.push({
      resource_type: resourceType,
      resource_id: row.resource_id,
      created_by_label: createdLabel,
      created_by_status: createdStatus.data === "known" && createdLabel === "Unknown" ? "unknown" : createdStatus.data,
      updated_by_label: updatedLabel,
      updated_by_status: updatedStatus.data === "known" && updatedLabel === "Unknown" ? "unknown" : updatedStatus.data,
    });
    seen.add(row.resource_id);
  }
  return safe;
}

export const getResourceActorSummaries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const requested = [...new Set(data.resource_ids)];
    try {
      // Database types may predate the source-only actor-summary migration.
      const { data: rows, error } = await (context.supabase as any).rpc("get_resource_actor_summary", {
        _resource_type: data.resource_type,
        _resource_ids: requested,
      });
      if (error || !Array.isArray(rows)) return { available: false as const, rows: [] as ResourceActorSummary[] };
      return { available: true as const, rows: normalizeResourceActorSummaries(rows, data.resource_type, requested) };
    } catch {
      // Missing migration or provider/access failure is not proof of no editor.
      return { available: false as const, rows: [] as ResourceActorSummary[] };
    }
  });
