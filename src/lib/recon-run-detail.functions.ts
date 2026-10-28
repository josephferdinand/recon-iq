import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";

const Scope = z.object({ tenant_id: z.string().uuid(), definition_id: z.string().uuid() });
const Page = z.number().int().min(0).default(0);
const PAGE_SIZE = 50;
const RUN_HISTORY_FIELDS = "id, run_uid, definition_id, status, matched_count, exception_count, total_rows, stats, started_at, completed_at";
const emptyStatusCounts = { match_groups: null, exception_items: null, exception_buckets: null };

/** Persisted fields returned for one exception item by get_recon_run_result_page. */
export type ReconRunResultExceptionItem = {
  id: string;
  public_case_id?: string | null;
  side?: string | null;
  reason?: string | null;
  status?: string | null;
  payload?: unknown;
  created_at?: string | null;
};

function runSummary<T extends { stats: unknown }>(row: T): Omit<T, "stats"> & { matched_input_memberships: number | null } {
  const { stats, ...summary } = row;
  const details = stats && typeof stats === "object" && !Array.isArray(stats)
    ? stats as Record<string, unknown>
    : null;
  const membershipCount = details?.matched_records;
  return {
    ...summary,
    matched_input_memberships: typeof membershipCount === "number" && Number.isFinite(membershipCount)
      ? membershipCount
      : null,
  };
}

export const listReconDefinitionRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => Scope.extend({ days: z.union([z.literal(1), z.literal(7), z.literal(14), z.literal(30), z.literal(90)]), page: Page }).parse(input))
  .handler(async ({ data, context }) => {
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();
    const [history, completed] = await Promise.all([
      context.supabase.from("recon_runs")
        .select(RUN_HISTORY_FIELDS, { count: "exact" })
        .eq("tenant_id", data.tenant_id)
        .eq("definition_id", data.definition_id)
        .gte("started_at", since)
        .order("started_at", { ascending: false })
        .order("id", { ascending: true })
        .range(data.page * PAGE_SIZE, (data.page + 1) * PAGE_SIZE - 1),
      context.supabase.from("recon_runs")
        .select(RUN_HISTORY_FIELDS, { count: "exact" })
        .eq("tenant_id", data.tenant_id)
        .eq("definition_id", data.definition_id)
        .eq("status", "completed")
        .gte("started_at", since)
        .order("started_at", { ascending: false })
        .order("id", { ascending: true })
        .limit(5),
    ]);
    if (history.error || completed.error || typeof history.count !== "number" || typeof completed.count !== "number") {
      throw new Error("Run history is unavailable. Please try again.");
    }
    return {
      rows: (history.data ?? []).map(runSummary),
      count: history.count,
      completedCount: completed.count,
      completedRuns: (completed.data ?? []).map(runSummary),
      pageSize: PAGE_SIZE,
    };
  });

export const getReconRunDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => z.object({
    tenant_id: z.string().uuid(), run_id: z.string().uuid(), page: Page,
    status: z.enum(["all", "match", "partial", "missing", "duplicate", "invalid_key", "other", "unavailable"]).default("all"),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: run, error: runError } = await context.supabase.from("recon_runs")
      .select("id, run_uid, definition_id, definition_snapshot, status, matched_count, exception_count, total_rows, stats, started_at, completed_at, definition:recon_definitions(name, recon_type, sides)")
      .eq("tenant_id", data.tenant_id).eq("id", data.run_id).maybeSingle();
    if (runError) throw new Error("Run details are unavailable. Please try again.");
    if (!run) return null;
    const [pageRead, statusRead] = await Promise.all([
      context.supabase.rpc("get_recon_run_result_page", {
        _tenant_id: data.tenant_id, _run_id: data.run_id, _page: data.page, _status: data.status,
      }),
      context.supabase.rpc("get_recon_run_result_status_counts", {
        _tenant_id: data.tenant_id, _run_id: data.run_id,
      }),
    ]);
    if (pageRead.error) throw new Error("Processed records are unavailable. Please try again.");
    if (!pageRead.data) return null;
    const pageResult = pageRead.data as { rows?: Json[]; field_names?: Json[]; parent_count?: number; has_next?: boolean; page_size?: number } | null;
    const statusCounts = statusRead.error || !statusRead.data ? emptyStatusCounts : statusRead.data as typeof emptyStatusCounts;
    return {
      run,
      results: pageResult?.rows ?? [], parentCount: pageResult?.parent_count ?? null,
      fieldNames: pageResult?.field_names ?? [],
      hasNext: pageResult?.has_next ?? false,
      statusCounts,
      pageSize: pageResult?.page_size ?? PAGE_SIZE,
    };
  });
