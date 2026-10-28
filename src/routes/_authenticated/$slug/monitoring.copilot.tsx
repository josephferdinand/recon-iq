/**
 * Phase 3 (7c) — Copilot tool-call monitoring dashboard.
 *
 * Surfaces last-24h tool call counts, p50/p95/p99 latency, error rate,
 * and the per-turn step-count distribution for the active tenant.
 */
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCopilotMonitoring, type CopilotMonitoringResult } from "@/lib/copilot-monitoring.functions";
import { getTenantBySlug } from "@/lib/tenants.functions";
import {
  getTopTenantsByAICost,
  getTopToolsByErrorRate,
  getSlowestToolsByP95,
  type TopTenantByCost,
  type ToolErrorRate,
  type ToolP95,
} from "@/lib/observability-queries.functions";

export const Route = createFileRoute("/_authenticated/$slug/monitoring/copilot")({
  component: CopilotMonitoringPage,
});

function CopilotMonitoringPage() {
  const { slug } = useParams({ from: "/_authenticated/$slug/monitoring/copilot" });
  const tenantFn = useServerFn(getTenantBySlug);
  const tenantQ = useQuery({
    queryKey: ["tenant-by-slug", slug],
    queryFn: async () => (await tenantFn({ data: { slug } })) as { id: string } | null,
  });
  const tenantId = tenantQ.data?.id ?? null;

  const fetcher = useServerFn(getCopilotMonitoring);
  const q = useQuery<CopilotMonitoringResult>({
    queryKey: ["copilot-monitoring", tenantId],
    enabled: !!tenantId,
    queryFn: async () =>
      fetcher({ data: { tenant_id: tenantId!, window_hours: 24 } }) as Promise<CopilotMonitoringResult>,
    refetchInterval: 60_000,
  });

  // Phase 5 — Platform-wide observability (platform_admin only; the
  // server fns hard-fail otherwise so non-admin renders will simply
  // hide the sections via the empty-state branches).
  // server fns hard-fail otherwise so non-admin renders will simply
  // hide the sections via the empty-state branches).
  const topTenantsFn = useServerFn(getTopTenantsByAICost);
  const topErrorsFn = useServerFn(getTopToolsByErrorRate);
  const slowestFn = useServerFn(getSlowestToolsByP95);
  const topTenantsQ = useQuery<TopTenantByCost[]>({
    queryKey: ["obs-top-tenants-cost", 7],
    queryFn: () => topTenantsFn({ data: { window_days: 7 } }),
    retry: false,
  });
  const topErrorsQ = useQuery<ToolErrorRate[]>({
    queryKey: ["obs-top-tools-errors", 24],
    queryFn: () => topErrorsFn({ data: { window_hours: 24 } }),
    retry: false,
  });
  const slowestQ = useQuery<ToolP95[]>({
    queryKey: ["obs-slowest-tools", 24],
    queryFn: () => slowestFn({ data: { window_hours: 24 } }),
    retry: false,
  });
  const showPlatform =
    topTenantsQ.isSuccess || topErrorsQ.isSuccess || slowestQ.isSuccess;


  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Copilot monitoring</h1>
          <p className="text-sm text-muted-foreground">
            Last 24 hours of Copilot tool-call telemetry, sourced from <code>ai_usage_events.tool_calls</code>.
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline">Turns: {q.data?.totals.turns ?? 0}</Badge>
          <Badge variant="outline">Calls: {q.data?.totals.tool_calls ?? 0}</Badge>
          <Badge variant={(q.data?.totals.errors ?? 0) > 0 ? "destructive" : "default"}>
            Errors: {q.data?.totals.errors ?? 0}
          </Badge>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Per-tool performance</CardTitle>
          <CardDescription>Count, latency percentiles, error rate.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">p50 (ms)</TableHead>
                <TableHead className="text-right">p95 (ms)</TableHead>
                <TableHead className="text-right">p99 (ms)</TableHead>
                <TableHead className="text-right">Error rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(q.data?.per_tool ?? []).map((t) => (
                <TableRow key={t.tool}>
                  <TableCell className="font-mono text-xs">{t.tool}</TableCell>
                  <TableCell className="text-right">{t.count}</TableCell>
                  <TableCell className="text-right">{t.p50_ms}</TableCell>
                  <TableCell className="text-right">{t.p95_ms}</TableCell>
                  <TableCell className="text-right">{t.p99_ms}</TableCell>
                  <TableCell className="text-right">
                    {(t.error_rate * 100).toFixed(2)}%
                  </TableCell>
                </TableRow>
              ))}
              {(q.data?.per_tool ?? []).length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                  No tool calls in the last 24h.
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Step-count distribution per turn</CardTitle>
          <CardDescription>How many tool steps the agent runs per Copilot turn.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Steps in turn</TableHead>
                <TableHead className="text-right">Turns</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(q.data?.step_count_distribution ?? []).map((r) => (
                <TableRow key={r.steps}>
                  <TableCell>{r.steps}</TableCell>
                  <TableCell className="text-right">{r.turns}</TableCell>
                </TableRow>
              ))}
              {(q.data?.step_count_distribution ?? []).length === 0 && (
                <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-6">
                  No data yet.
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {showPlatform && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Platform observability</h2>
            <p className="text-sm text-muted-foreground">
              Cross-tenant view for platform administrators. Sourced from
              <code className="mx-1">ai_usage_events</code> over the selected window.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top tenants by AI cost (7d)</CardTitle>
                <CardDescription>USD spend per tenant.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tenant</TableHead>
                      <TableHead className="text-right">Cost (USD)</TableHead>
                      <TableHead className="text-right">Calls</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(topTenantsQ.data ?? []).map((t) => (
                      <TableRow key={t.tenant_id}>
                        <TableCell className="font-mono text-xs">{t.tenant_id.slice(0, 8)}…</TableCell>
                        <TableCell className="text-right">${t.cost_usd.toFixed(4)}</TableCell>
                        <TableCell className="text-right">{t.call_count}</TableCell>
                      </TableRow>
                    ))}
                    {(topTenantsQ.data ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                        No spend in window.
                      </TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top tools by error rate (24h)</CardTitle>
                <CardDescription>Min 5 calls.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tool</TableHead>
                      <TableHead className="text-right">Error rate</TableHead>
                      <TableHead className="text-right">Calls</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(topErrorsQ.data ?? []).map((t) => (
                      <TableRow key={t.tool}>
                        <TableCell className="font-mono text-xs">{t.tool}</TableCell>
                        <TableCell className="text-right">{(t.error_rate * 100).toFixed(2)}%</TableCell>
                        <TableCell className="text-right">{t.call_count}</TableCell>
                      </TableRow>
                    ))}
                    {(topErrorsQ.data ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                        No errors in window.
                      </TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Slowest tools by p95 (24h)</CardTitle>
                <CardDescription>Min 5 calls.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tool</TableHead>
                      <TableHead className="text-right">p95 (ms)</TableHead>
                      <TableHead className="text-right">Calls</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(slowestQ.data ?? []).map((t) => (
                      <TableRow key={t.tool}>
                        <TableCell className="font-mono text-xs">{t.tool}</TableCell>
                        <TableCell className="text-right">{t.p95_ms}</TableCell>
                        <TableCell className="text-right">{t.call_count}</TableCell>
                      </TableRow>
                    ))}
                    {(slowestQ.data ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                        No data in window.
                      </TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </section>
      )}
    </div>
  );
}
