import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { BackButton } from "@/components/back-button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, AlertTriangle, CheckCircle2, Database, Loader2, PlugZap, RefreshCw, TriangleAlert, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getTenantPipelineDashboard } from "@/lib/tenant-pipeline.functions";

export const Route = createFileRoute("/_authenticated/$slug/tenant/pipeline-status")({
  head: () => ({ meta: [
    { title: "Tenant pipeline status & ingestion dashboard" },
    { name: "description", content: "Per-tenant ingestion performance, failures, and alerts across data sources, ERP connectors, parsers, and data-prep pipelines." },
  ] }),
  component: TenantPipelinePage,
});

const WINDOWS: { label: string; minutes: number }[] = [
  { label: "1h", minutes: 60 },
  { label: "6h", minutes: 360 },
  { label: "24h", minutes: 1440 },
  { label: "7d", minutes: 10080 },
  { label: "30d", minutes: 43200 },
];

function TenantPipelinePage() {
  const { slug } = useParams({ from: "/_authenticated/$slug/tenant/pipeline-status" });
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [windowMin, setWindowMin] = useState(1440);

  useQuery({
    queryKey: ["tenant-id", slug],
    queryFn: async () => {
      const { data } = await supabase.from("tenants").select("id").eq("slug", slug).maybeSingle();
      const id = (data as any)?.id ?? null;
      setTenantId(id);
      return id;
    },
    staleTime: 60_000,
  });

  const fn = useServerFn(getTenantPipelineDashboard);
  const q = useQuery({
    queryKey: ["tenant-pipeline", tenantId, windowMin],
    enabled: !!tenantId,
    queryFn: () => fn({ data: { tenant_id: tenantId!, window_minutes: windowMin } }),
    refetchInterval: 30_000,
  });

  const d = q.data;

  return (
    <div className="container max-w-7xl mx-auto py-6 space-y-4">
      <BackButton />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Pipeline status — {slug}
          </h1>
          <p className="text-sm text-muted-foreground">
            Ingestion performance and failures for your tenant. Auto-refreshes every 30s.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(windowMin)} onValueChange={(v) => setWindowMin(Number(v))}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              {WINDOWS.map((w) => <SelectItem key={w.minutes} value={String(w.minutes)}>{w.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button aria-label="Refresh pipeline status" variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            {q.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {q.isLoading || !d ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading pipeline metrics…
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <StatCard icon={Database} label="Data source runs" bucket={d.data_sources} rowsLabel="rows ingested" />
            <StatCard icon={PlugZap} label="ERP connector runs" bucket={d.erp_connectors} rowsLabel="rows fetched"
              extra={`p50 ${Math.round((d.erp_connectors as any).p50_ms)}ms · p95 ${Math.round((d.erp_connectors as any).p95_ms)}ms`} />
            <StatCard icon={Activity} label="Parser runs" bucket={d.parsers} rowsLabel="messages out" />
            <StatCard icon={Activity} label="Data-prep runs" bucket={d.data_prep} rowsLabel="rows out" />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <TriangleAlert className="h-4 w-4" /> Alerts
                </CardTitle>
                <CardDescription>{d.alerts.total} in window · {d.alerts.unacknowledged} unacknowledged</CardDescription>
              </CardHeader>
              <CardContent className="text-xs space-y-1">
                {Object.entries(d.alerts.by_severity).map(([sev, n]) => (
                  <div key={sev} className="flex justify-between">
                    <span className="capitalize">{sev}</span>
                    <Badge variant={sev === "critical" || sev === "high" ? "destructive" : sev === "medium" ? "secondary" : "outline"}>{n as number}</Badge>
                  </div>
                ))}
                {d.alerts.total === 0 && <div className="text-muted-foreground">No alerts in window.</div>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Database className="h-4 w-4" /> Source health
                </CardTitle>
                <CardDescription>Latest snapshot per data source</CardDescription>
              </CardHeader>
              <CardContent className="text-xs space-y-1">
                <div className="flex justify-between"><span>Observed sources</span><span className="font-mono">{d.health.sources_observed}</span></div>
                <div className="flex justify-between"><span>Degraded</span><span className="font-mono">{d.health.degraded}</span></div>
                <div className="flex justify-between"><span>Schema drift</span><span className="font-mono">{d.health.with_drift}</span></div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <XCircle className="h-4 w-4" /> Failures
                </CardTitle>
                <CardDescription>Most recent 25 across all pipelines</CardDescription>
              </CardHeader>
              <CardContent className="text-xs">
                <div className="font-mono">
                  {d.failures.length} in the last {WINDOWS.find((w) => w.minutes === windowMin)?.label ?? `${windowMin}m`}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Recent failures</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[160px]">When</TableHead>
                      <TableHead className="w-[120px]">Pipeline</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="w-[100px]">Status</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.failures.map((f: any) => (
                      <TableRow key={`${f.source}-${f.id}`}>
                        <TableCell className="text-xs font-mono text-muted-foreground">{f.at ? new Date(f.at).toLocaleString() : "—"}</TableCell>
                        <TableCell><Badge variant="outline">{f.source}</Badge></TableCell>
                        <TableCell className="text-xs font-mono truncate max-w-[240px]">{String(f.ref ?? "")}</TableCell>
                        <TableCell><Badge variant="destructive">{f.status}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground truncate max-w-[420px]" title={f.error ?? ""}>{f.error ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                    {d.failures.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">
                        <CheckCircle2 className="h-4 w-4 inline mr-1 text-green-800 dark:text-green-300" /> No failures in this window.
                      </TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Recent alerts</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[160px]">When</TableHead>
                      <TableHead className="w-[100px]">Severity</TableHead>
                      <TableHead className="w-[140px]">Type</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead className="w-[100px]">Ack</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.alerts.recent.map((a: any) => (
                      <TableRow key={a.id}>
                        <TableCell className="text-xs font-mono text-muted-foreground">{new Date(a.created_at).toLocaleString()}</TableCell>
                        <TableCell><Badge variant={a.severity === "critical" || a.severity === "high" ? "destructive" : a.severity === "medium" ? "secondary" : "outline"}>{a.severity}</Badge></TableCell>
                        <TableCell className="text-xs font-mono">{a.alert_type}</TableCell>
                        <TableCell className="text-xs">{a.message}</TableCell>
                        <TableCell className="text-xs">{a.acknowledged_at ? <CheckCircle2 className="h-4 w-4 text-green-800 dark:text-green-300" /> : <span className="text-muted-foreground">—</span>}</TableCell>
                      </TableRow>
                    ))}
                    {d.alerts.recent.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">No alerts.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon, label, bucket, rowsLabel, extra,
}: {
  icon: any; label: string; bucket: any; rowsLabel: string; extra?: string;
}) {
  const successRate = bucket.total ? Math.round((bucket.ok / bucket.total) * 100) : 100;
  const tone = successRate >= 95 ? "text-green-800 dark:text-green-300" : successRate >= 80 ? "text-amber-800 dark:text-amber-200" : "text-destructive";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground font-medium">
          <Icon className="h-4 w-4" /> {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold">{bucket.total}</span>
          <span className={`text-sm font-mono ${tone}`}>{successRate}% ok</span>
        </div>
        <div className="text-xs text-muted-foreground flex gap-3 flex-wrap">
          <span className="text-green-800 dark:text-green-300">✓ {bucket.ok}</span>
          <span className="text-destructive">✗ {bucket.fail}</span>
          {bucket.running > 0 && <span>⟳ {bucket.running}</span>}
        </div>
        <div className="text-xs text-muted-foreground">
          {bucket.rows.toLocaleString()} {rowsLabel}
        </div>
        {extra && <div className="text-xs text-muted-foreground font-mono">{extra}</div>}
        <div className="text-[11px] text-muted-foreground">
          Last: {bucket.last_at ? new Date(bucket.last_at).toLocaleString() : "—"}
        </div>
      </CardContent>
    </Card>
  );
}
