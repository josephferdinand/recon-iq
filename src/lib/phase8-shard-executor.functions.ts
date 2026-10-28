/**
 * Phase 8 — Sharded match executor server fns.
 *
 * Surfaces the executor registry and per-shard run rows that let a recon
 * job be split across many workers for billion-row tenants.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listShardExecutors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({}).parse(d))
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("shard_executor_registry")
      .select("code,name,description,max_shards,enabled")
      .eq("enabled", true)
      .order("code");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listShardRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      recon_run_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("recon_shard_runs")
      .select("id,recon_run_id,executor_code,shard_index,shard_count,status,rows_in,rows_matched,rows_unmatched,started_at,ended_at,error_text")
      .eq("tenant_id", data.tenant_id);
    if (data.recon_run_id) q = q.eq("recon_run_id", data.recon_run_id);
    const { data: rows, error } = await q.order("shard_index", { ascending: true }).limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/**
 * Plan a shard layout for a given executor + input row estimate.
 * Pure compute helper for the UI so users can preview how a run would split.
 */
export function planShards(executor_code: string, max_shards: number, total_rows: number): Array<{ shard_index: number; rows_estimate: number }> {
  const shards = Math.min(Math.max(1, max_shards), 256);
  const base = Math.floor(total_rows / shards);
  const remainder = total_rows - base * shards;
  return Array.from({ length: shards }, (_, i) => ({
    shard_index: i,
    rows_estimate: base + (i < remainder ? 1 : 0),
  }));
}
