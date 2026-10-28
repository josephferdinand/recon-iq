import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { reconHealthOverview, auditTraceFor } from "@/lib/recon-health.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Activity, CheckCircle2, XCircle, RefreshCw, Search, AlertTriangle, Package } from "lucide-react";
import { formatReconRunId } from "@/lib/recon-run-id";

interface Props {
  /** null/undefined → cross-tenant (platform admin). */
  tenantId?: string | null;
}

function statusPill(status: string) {
  const s = String(status ?? "").toLowerCase();
  if (s === "completed" || s === "succeeded" || s === "ready") {
    return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">{status}</Badge>;
  }
  if (s === "failed") return <Badge variant="destructive">{status}</Badge>;
  if (s === "running" || s === "started" || s === "materializing" || s === "installing") {
    return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30">{status}</Badge>;
  }
  return <Badge variant="outline">{status}</Badge>;
}

export function ReconHealthDashboard({ tenantId }: Props) {
  const qc = useQueryClient();
  const overviewFn = useServerFn(reconHealthOverview);
  const traceFn = useServerFn(auditTraceFor);
  const [windowHours, setWindowHours] = useState(72);
  const [trace, setTrace] = useState<{ open: boolean; rows: any[]; title: string } | null>(null);

  const dataQ = useQuery({
    queryKey: ["recon-health", tenantId ?? "all", windowHours],
    queryFn: () => overviewFn({ data: { tenant_id: tenantId ?? null, window_hours: windowHours } }),
  });

  async function openTrace(resourceType: string, resourceId: string, tenant: string, label: string) {
    if (!tenant) return;
    const rows = await traceFn({ data: { tenant_id: tenant, resource_type: resourceType, resource_id: resourceId, limit: 100 } });
    setTrace({ open: true, rows: rows as any[], title: label });
  }

  const totals = dataQ.data?.totals ?? { runs: 0, succeeded: 0, failed: 0, running: 0 };
  const installs = dataQ.data?.installs ?? [];
  const runs = dataQ.data?.recent_runs ?? [];
  const pipes = dataQ.data?.recent_pipelines ?? [];
  const topFails = dataQ.data?.top_failures ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Reconciliation health</h2>
          <p className="text-sm text-muted-foreground">
            {tenantId ? "Tenant view" : "Cross-tenant platform view"} — last {windowHours} hours
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(windowHours)} onValueChange={(v) => setWindowHours(Number(v))}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[24, 72, 168, 720].map((h) => (
                <SelectItem key={h} value={String(h)}>Last {h}h</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["recon-health"] })}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <StatCard icon={<Activity className="h-5 w-5 text-muted-foreground" />} label="Recon runs" value={totals.runs} />
        <StatCard icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />} label="Succeeded" value={totals.succeeded} />
        <StatCard icon={<XCircle className="h-5 w-5 text-destructive" />} label="Failed" value={totals.failed} className={totals.failed > 0 ? "border-destructive/40" : ""} />
        <StatCard icon={<Activity className="h-5 w-5 text-amber-600" />} label="Running" value={totals.running} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Package className="h-4 w-4" /> Regulatory pack installs</CardTitle>
          <CardDescription>Install status across recent installs. Click any install to view full audit trail.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Pack</th>
                <th className="px-4 py-2">Tenant</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Started</th>
                <th className="px-4 py-2">Completed</th>
                <th className="px-4 py-2">Processes</th>
                <th className="px-4 py-2">Error</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {installs.map((i: any) => (
                <tr key={i.id} className="border-b align-top">
                  <td className="px-4 py-2 text-xs font-mono">{i.installed_version}</td>
                  <td className="px-4 py-2 text-xs font-mono text-muted-foreground">{String(i.tenant_id).slice(0, 8)}</td>
                  <td className="px-4 py-2">{statusPill(i.status)}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{i.started_at ? new Date(i.started_at).toLocaleString() : "—"}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{i.completed_at ? new Date(i.completed_at).toLocaleString() : "—"}</td>
                  <td className="px-4 py-2 text-xs">{i.generated_process_count ?? 0}</td>
                  <td className="px-4 py-2 text-xs text-destructive max-w-[240px] truncate" title={i.error_message ?? i.materialization_error ?? ""}>
                    {i.error_message ?? i.materialization_error ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    <Button size="sm" variant="ghost" onClick={() => openTrace("regulatory_pack_installs", i.id, i.tenant_id, `Install ${i.installed_version}`)}>
                      <Search className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
              {installs.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">No regulatory installs.</td></tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent recon runs</CardTitle>
            <CardDescription>Drilldown opens full audit trail for the run.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Run</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Started</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r: any) => (
                  <tr key={r.id} className="border-b">
                    <td className="px-4 py-2"><span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold tracking-wide">{formatReconRunId(r.run_uid, r.id)}</span></td>
                    <td className="px-4 py-2">{statusPill(r.status)}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{r.started_at ? new Date(r.started_at).toLocaleString() : "—"}</td>
                    <td className="px-4 py-2">
                      <Button size="sm" variant="ghost" onClick={() => openTrace("recon_runs", r.id, r.tenant_id, `Run ${formatReconRunId(r.run_uid, r.id)}`)}>
                        <Search className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {runs.length === 0 ? (<tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">No runs in window.</td></tr>) : null}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent data-prep pipelines</CardTitle>
            <CardDescription>Pipeline-level progress.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Pipeline</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Started</th>
                  <th className="px-4 py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {pipes.map((p: any) => (
                  <tr key={p.id} className="border-b">
                    <td className="px-4 py-2 font-mono text-xs">{String(p.pipeline_id).slice(0, 8)}</td>
                    <td className="px-4 py-2">{statusPill(p.status)}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{p.started_at ? new Date(p.started_at).toLocaleString() : "—"}</td>
                    <td className="px-4 py-2 text-xs text-destructive max-w-[180px] truncate" title={p.error ?? ""}>{p.error ?? "—"}</td>
                  </tr>
                ))}
                {pipes.length === 0 ? (<tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">No pipeline runs.</td></tr>) : null}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" /> Top failure reasons</CardTitle>
          <CardDescription>Grouped error signatures across recon runs and data-prep pipelines.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Reason</th>
                <th className="px-4 py-2">Source</th>
                <th className="px-4 py-2">Count</th>
              </tr>
            </thead>
            <tbody>
              {topFails.map((f: any, idx: number) => (
                <tr key={idx} className="border-b">
                  <td className="px-4 py-2 text-xs">{f.reason}</td>
                  <td className="px-4 py-2"><Badge variant="outline">{f.source}</Badge></td>
                  <td className="px-4 py-2 text-xs">{f.count}</td>
                </tr>
              ))}
              {topFails.length === 0 ? (<tr><td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">No failures recorded — nice work.</td></tr>) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Sheet open={!!trace?.open} onOpenChange={(o) => setTrace(o ? trace : null)}>
        <SheetContent className="w-[600px] sm:max-w-[600px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Audit trail — {trace?.title}</SheetTitle>
            <SheetDescription>Hash-chained audit events for this resource.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {(trace?.rows ?? []).map((r: any) => (
              <div key={r.id} className="rounded border p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="font-mono text-[10px]">{r.action}</Badge>
                  <span className="text-[10px] text-muted-foreground">{new Date(r.occurred_at).toLocaleString()}</span>
                </div>
                <div className="text-xs text-muted-foreground">by {r.actor_email ?? "system"}</div>
                {r.context ? (
                  <pre className="overflow-auto rounded bg-muted/60 p-2 text-[10px] leading-relaxed max-h-40">{JSON.stringify(r.context, null, 2)}</pre>
                ) : null}
              </div>
            ))}
            {(trace?.rows ?? []).length === 0 ? (
              <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">No audit events for this resource.</div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StatCard({ icon, label, value, className }: { icon: React.ReactNode; label: string; value: number; className?: string }) {
  return (
    <Card className={className}>
      <CardContent className="p-4 flex items-center gap-3">
        {icon}
        <div>
          <div className="text-2xl font-semibold">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
