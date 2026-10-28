import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getTenantBySlug } from "@/lib/tenants.functions";
import { getLlmChainHealthReport } from "@/lib/llm.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Activity, AlertTriangle, CheckCircle2, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/_authenticated/$slug/ai-governance/chain-health")({
  component: ChainHealthPage,
  errorComponent: ({ error }) => <div className="p-6 text-sm text-destructive">Failed: {error instanceof Error ? error.message : "An unexpected error occurred."}</div>,
  notFoundComponent: () => <div className="p-6">Not found.</div>,
});

const WINDOWS = [7, 14, 30, 60, 90] as const;

function ChainHealthPage() {
  const { slug } = useParams({ from: "/_authenticated/$slug/ai-governance/chain-health" });
  const getTenant = useServerFn(getTenantBySlug);
  const getReport = useServerFn(getLlmChainHealthReport);
  const [windowDays, setWindowDays] = useState<number>(30);

  const tenantQ = useQuery({ queryKey: ["tenant", slug], queryFn: () => getTenant({ data: { slug } }) });
  const tenantId = tenantQ.data?.id;
  const reportQ = useQuery({
    queryKey: ["chain-health", tenantId, windowDays],
    queryFn: () => getReport({ data: { tenant_id: tenantId!, window_days: windowDays } }),
    enabled: !!tenantId,
  });
  const r = reportQ.data;

  const rateColor = (n: number | null) =>
    n === null ? "secondary" : n >= 95 ? "default" : n >= 80 ? "secondary" : "destructive";

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/$slug/tenant" params={{ slug }}><ArrowLeft className="h-4 w-4 mr-1" />Back</Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">LLM Chain Health Report</h1>
            <p className="text-sm text-muted-foreground">
              Latency and failure-rate trends across the tenant's configured LLM chain.
            </p>
          </div>
        </div>
        <Select value={String(windowDays)} onValueChange={(v) => setWindowDays(Number(v))}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {WINDOWS.map((w) => <SelectItem key={w} value={String(w)}>Last {w} days</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {reportQ.isLoading && <div className="text-sm text-muted-foreground">Loading report…</div>}
      {reportQ.error && <div className="text-sm text-destructive">Failed to load: {(reportQ.error as Error).message}</div>}
      {r && r.overall.total === 0 && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No chain-test data recorded in the last {windowDays} days. Run "Test entire chain" from the LLM tab to
            begin collecting health telemetry.
          </CardContent>
        </Card>
      )}

      {r && r.overall.total > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" />Probes</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-semibold">{r.overall.total}</div>
                <div className="text-xs text-muted-foreground">{r.overall.pass} pass · {r.overall.fail} fail</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />Pass rate</CardTitle></CardHeader>
              <CardContent><Badge variant={rateColor(r.overall.pass_rate)}>{r.overall.pass_rate ?? "—"}%</Badge></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4" />Latency (p50 / p95)</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-semibold">{r.overall.p50_latency_ms ?? "—"} / {r.overall.p95_latency_ms ?? "—"} <span className="text-sm text-muted-foreground">ms</span></div>
                <div className="text-xs text-muted-foreground">avg {r.overall.avg_latency_ms ?? "—"} ms</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Chosen rate</CardTitle></CardHeader>
              <CardContent><Badge variant={rateColor(r.overall.chosen_rate)}>{r.overall.chosen_rate ?? "—"}%</Badge>
                <div className="text-xs text-muted-foreground mt-1">{r.overall.chosen_count} of {r.overall.total} probes served the request</div></CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>By provider / tier</CardTitle><CardDescription>Ranked by probe volume.</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Provider</TableHead><TableHead>Model</TableHead><TableHead>Tier</TableHead>
                  <TableHead className="text-right">Probes</TableHead><TableHead className="text-right">Pass rate</TableHead>
                  <TableHead className="text-right">avg (ms)</TableHead><TableHead className="text-right">p95 (ms)</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {r.by_provider.map((b, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{b.provider}</TableCell>
                      <TableCell className="text-muted-foreground">{b.model ?? "—"}</TableCell>
                      <TableCell><Badge variant="outline">{b.scenario}</Badge></TableCell>
                      <TableCell className="text-right">{b.total}</TableCell>
                      <TableCell className="text-right"><Badge variant={rateColor(b.pass_rate)}>{b.pass_rate ?? "—"}%</Badge></TableCell>
                      <TableCell className="text-right">{b.avg_latency_ms ?? "—"}</TableCell>
                      <TableCell className="text-right">{b.p95_latency_ms ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Daily trend</CardTitle><CardDescription>Probe volume, pass rate, and average latency per day.</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Day</TableHead><TableHead className="text-right">Probes</TableHead>
                  <TableHead className="text-right">Pass rate</TableHead><TableHead className="text-right">avg (ms)</TableHead>
                  <TableHead className="text-right">p95 (ms)</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {r.by_day.map((d) => (
                    <TableRow key={d.day}>
                      <TableCell className="font-mono text-xs">{d.day}</TableCell>
                      <TableCell className="text-right">{d.total}</TableCell>
                      <TableCell className="text-right"><Badge variant={rateColor(d.pass_rate)}>{d.pass_rate ?? "—"}%</Badge></TableCell>
                      <TableCell className="text-right">{d.avg_latency_ms ?? "—"}</TableCell>
                      <TableCell className="text-right">{d.p95_latency_ms ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {r.recent_failures.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" />Recent failures</CardTitle>
                <CardDescription>Last 20 failing probes with error messages.</CardDescription></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>When</TableHead><TableHead>Provider</TableHead><TableHead>Model</TableHead>
                    <TableHead>Tier</TableHead><TableHead>Latency</TableHead><TableHead>Error</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {r.recent_failures.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="font-mono text-xs">{new Date(f.created_at).toLocaleString()}</TableCell>
                        <TableCell>{f.provider}</TableCell>
                        <TableCell className="text-muted-foreground">{f.model ?? "—"}</TableCell>
                        <TableCell><Badge variant="outline">{f.scenario}</Badge></TableCell>
                        <TableCell>{f.latency_ms ?? "—"} ms</TableCell>
                        <TableCell className="text-destructive text-xs">{f.error ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
