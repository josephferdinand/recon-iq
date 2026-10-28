// Phase 7 — Recon Knowledge Graph
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const upsertKgNode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      node_type: z.string().min(1),
      node_key: z.string().min(1),
      label: z.string().min(1),
      attrs: z.record(z.string(), z.unknown()).default({}),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("recon_kg_nodes").upsert(data as never, { onConflict: "tenant_id,node_type,node_key" }).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const upsertKgEdge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      src_node_id: z.string().uuid(),
      dst_node_id: z.string().uuid(),
      edge_type: z.string().min(1),
      weight: z.number().default(1),
      attrs: z.record(z.string(), z.unknown()).default({}),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("recon_kg_edges").insert(data as never).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const getKgNeighbors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      node_id: z.string().uuid(),
      max_depth: z.number().int().min(1).max(5).default(2),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("get_kg_neighbors", {
      _tenant_id: data.tenant_id,
      _node_id: data.node_id,
      _max_depth: data.max_depth,
    } as never);
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{ node_id: string; depth: number; edge_type: string }>;
  });

export const listKgNodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      node_type: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(200),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("recon_kg_nodes").select("*").eq("tenant_id", data.tenant_id).limit(data.limit);
    if (data.node_type) q = q.eq("node_type", data.node_type);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
