/**
 * Phase 8 — Digital twin of operations server fns.
 *
 * Graph of sources, cutoffs, SLAs, controls, escalations + traversal RPC.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertPhaseCPerm } from "./phase-c-rbac.functions";

const NodeType = z.enum(["source","cutoff","sla","control","escalation","workflow","recon"]);

export const upsertTwinNode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      node_type: NodeType,
      node_key: z.string().min(1).max(200),
      label: z.string().min(1).max(200),
      status: z.enum(["ok","warning","breached","unknown"]).default("ok"),
      attributes: z.record(z.string(), z.unknown()).default({}),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPhaseCPerm(context, data.tenant_id, "twin_admin");
    const { data: row, error } = await context.supabase
      .from("digital_twin_nodes")
      .upsert(data as never, { onConflict: "tenant_id,node_type,node_key" })
      .select("id,node_type,node_key,status")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const upsertTwinEdge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      src_node_id: z.string().uuid(),
      dst_node_id: z.string().uuid(),
      rel: z.string().min(1).max(60),
      weight: z.number().min(0).max(1000).default(1),
      attributes: z.record(z.string(), z.unknown()).default({}),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPhaseCPerm(context, data.tenant_id, "twin_admin");
    const { data: row, error } = await context.supabase
      .from("digital_twin_edges")
      .upsert(data as never, { onConflict: "tenant_id,src_node_id,dst_node_id,rel" })
      .select("id,rel,weight")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listTwinNodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      node_type: NodeType.optional(),
      status: z.enum(["ok", "warning", "breached", "unknown"]).optional(),
      search: z.string().max(200).optional(),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(1000).default(300),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPhaseCPerm(context, data.tenant_id, "twin_view");
    let q = context.supabase
      .from("digital_twin_nodes")
      .select("id,node_type,node_key,label,status,attributes,updated_at", { count: "exact" })
      .eq("tenant_id", data.tenant_id);
    if (data.node_type) q = q.eq("node_type", data.node_type);
    if (data.status) q = q.eq("status", data.status);
    if (data.search && data.search.trim()) {
      const s = data.search.trim().replace(/[%_]/g, "\\$&");
      q = q.or(`label.ilike.%${s}%,node_key.ilike.%${s}%`);
    }
    const from = data.offset;
    const to = data.offset + data.limit - 1;
    const { data: rows, error, count } = await q
      .order("node_type")
      .order("node_key")
      .range(from, to);
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? (rows?.length ?? 0) };
  });

export const getTwinStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPhaseCPerm(context, data.tenant_id, "twin_view");
    const started = Date.now();
    const { data: rows, error } = await context.supabase.rpc("get_digital_twin_stats", {
      _tenant_id: data.tenant_id,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(rows) ? rows[0] : rows;
    return {
      total_nodes: (row?.total_nodes as number) ?? 0,
      total_edges: (row?.total_edges as number) ?? 0,
      ok_count: (row?.ok_count as number) ?? 0,
      warning_count: (row?.warning_count as number) ?? 0,
      breached_count: (row?.breached_count as number) ?? 0,
      unknown_count: (row?.unknown_count as number) ?? 0,
      types: (row?.types_json as Record<string, number>) ?? {},
      last_updated: (row?.last_updated as string | null) ?? null,
      query_ms: Date.now() - started,
    };
  });


export const getTwinSubgraph = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      root_node_id: z.string().uuid(),
      max_depth: z.number().int().min(1).max(5).default(2),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPhaseCPerm(context, data.tenant_id, "twin_view");
    const { data: rows, error } = await context.supabase.rpc("get_digital_twin_subgraph", {
      _tenant_id: data.tenant_id,
      _root_node_id: data.root_node_id,
      _max_depth: data.max_depth,
    });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/**
 * Pure helper — roll a list of node statuses up into a single aggregate
 * (used by the UI summary cards).
 */
export function rollupTwinStatus(statuses: Array<"ok" | "warning" | "breached" | "unknown">): "ok" | "warning" | "breached" | "unknown" {
  if (statuses.some((s) => s === "breached")) return "breached";
  if (statuses.some((s) => s === "warning")) return "warning";
  if (statuses.length === 0 || statuses.every((s) => s === "unknown")) return "unknown";
  return "ok";
}
