import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const value = z.number().finite();
const metric = (v: z.ZodTypeAny) => z.object({ value: v, delta: value.nullable() });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const workspaceTeamMetricsSchema = z.object({
  scope: z.literal("team"),
  scope_access: z.object({ my: z.literal(true), team: z.literal(true), tenant: z.boolean() }),
  scope_empty: z.boolean(), provenance: z.string().min(1), window_days: count.min(7).max(180), as_of: z.string().datetime(),
  availability: z.object({ definitions: z.literal(true), data_sources: z.literal(true), schedules: z.literal(true), tickets: z.literal(false), ai_usage: z.literal(false) }),
  kpis: z.object({
    reconciliations: metric(count), match_rate: metric(value.min(0).max(100).nullable()), runs: metric(count),
    open_exceptions: metric(count), mttr_hours: metric(value.nonnegative().nullable()), open_tickets: metric(z.null()),
    success_rate: metric(value.min(0).max(100).nullable()), data_sources: metric(count), schedules_active: metric(count),
  }),
  throughput: z.array(z.object({ date: day, runs: count, matched: count.nullable(), unmatched: count.nullable(), rate: value.min(0).max(100).nullable(), failed: count, completed: count, metricsComplete: z.boolean() })),
  exceptions_flow: z.array(z.object({ date: day, opened: count, resolved: count })),
  severity: z.array(z.object({ name: z.string(), value: count })),
  lifecycle: z.array(z.object({ name: z.string(), value: count })),
  ageing: z.array(z.object({ name: z.string(), value: count })),
  top_recons: z.array(z.object({ id: z.string().uuid(), name: z.string(), type: z.string(), open: count })).max(6),
  ds_mix: z.array(z.object({ name: z.string(), value: count })),
  tickets_by_priority: z.array(z.object({ name: z.string(), value: count })),
  ai: z.object({ tokens_in: count, tokens_out: count, cost_usd: value.nonnegative(), series: z.array(z.object({ date: day, cost: value.nonnegative(), tokens: count })) }),
  recent_runs: z.array(z.object({ id: z.string().uuid(), definition_id: z.string().uuid(), status: z.string(), started_at: z.string(), recon_name: z.string(), record_metrics_available: z.boolean(), matched_records: count.nullable(), record_total: count.nullable(), record_match_rate: value.nullable() }).passthrough()).max(8),
  totals: z.object({ matched_records: count, total_rows: count, completed_runs: count, runs_missing_record_counts: count, exception_items: count, record_metrics_available: z.boolean(), failures: count }),
});
export type WorkspaceTeamMetrics = z.infer<typeof workspaceTeamMetricsSchema>;

export function workspaceDashboardFailure(error: unknown): Error {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "57014") return new Error("Team metrics timed out. No totals were confirmed. Retry, or return to My metrics.");
  if (code === "42501") return new Error("Team access could not be verified. No totals were returned. Ask a tenant administrator to review your current BU/group access.");
  return new Error("Team metrics could not be confirmed. No partial totals were returned. Retry, or return to My metrics.");
}

export async function loadWorkspaceTeamMetrics(
  rpc: (name: string, args: { _tenant_id: string; _window_days: number }) => PromiseLike<{ data: unknown; error: unknown }>,
  tenantId: string,
  windowDays: number,
): Promise<WorkspaceTeamMetrics> {
  const result = await rpc("get_workspace_dashboard_team_metrics", { _tenant_id: tenantId, _window_days: windowDays });
  if (result.error) throw workspaceDashboardFailure(result.error);
  const parsed = workspaceTeamMetricsSchema.safeParse(result.data);
  if (!parsed.success || parsed.data.throughput.length !== windowDays || parsed.data.exceptions_flow.length !== windowDays) {
    throw workspaceDashboardFailure(null);
  }
  return parsed.data;
}
