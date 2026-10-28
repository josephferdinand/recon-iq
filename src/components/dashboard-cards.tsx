import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTenantDashboard } from "@/lib/dashboard.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Database, GitBranch, ShieldAlert, LifeBuoy, TrendingUp, Activity } from "lucide-react";

export function DashboardCards({ tenantId }: { tenantId: string }) {
  const fn = useServerFn(getTenantDashboard);
  const q = useQuery({
    queryKey: ["tenant-dashboard", tenantId],
    queryFn: () => fn({ data: { tenant_id: tenantId } }),
    refetchInterval: 30_000,
    staleTime: 20_000,
    gcTime: 5 * 60_000,
  });

  if (q.isLoading) return <div className="grid gap-4 md:grid-cols-4"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>;
  if (q.isError) return <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"><div className="font-medium">Dashboard data is unavailable.</div><p className="mt-1 text-muted-foreground">Check your connection and retry.</p><button className="mt-2 underline underline-offset-2" onClick={() => q.refetch()} disabled={q.isFetching}>{q.isFetching ? "Retrying…" : "Retry"}</button></div>;
  if (!q.data) return null;
  const d = q.data;
  const sev = d.severity_counts;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        <Kpi icon={Database} label="Data sources" value={d.counts.data_sources} hint="CSV ingested" />
        <Kpi icon={GitBranch} label="Reconciliations" value={d.counts.recons} hint={`${d.runs_30d} runs · 30d`} />
        <Kpi icon={ShieldAlert} label="Open exceptions" value={d.counts.open_exceptions} hint={`${sev.critical}C · ${sev.high}H · ${sev.medium}M · ${sev.low}L`} />
        <Kpi icon={LifeBuoy} label="Open tickets" value={d.counts.open_tickets} hint="Workspace + escalated" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm"><TrendingUp className="h-4 w-4" /> Match rate (30 days)</CardTitle>
            <CardDescription>Matched input records / processed input records in completed runs ({d.runs_30d} runs in the window)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="font-display text-4xl font-semibold">{d.match_rate_available && d.match_rate_30d !== null ? `${d.match_rate_30d}%` : "N/A"}</div>
            {d.match_rate_available && d.match_rate_30d !== null ? <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${d.match_rate_30d}%` }} /></div> : <p className="mt-2 text-xs text-muted-foreground">Completed runs do not contain complete record totals.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm"><Activity className="h-4 w-4" /> Recent runs</CardTitle>
            <CardDescription>Latest 8 across all rekons</CardDescription>
          </CardHeader>
          <CardContent>
            {d.recent_runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs yet — once a ReconIQ recon executes, results appear here. Example: Demo Bank Nostro USD vs GL — Daily, completed 2026-06-26 06:17 UTC, 1,247 matches / 3 breaks.</p>
            ) : (
              <ul className="space-y-2">
                {d.recent_runs.map((r: any) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 text-xs">
                    <Badge variant={r.status === "completed" ? "default" : r.status === "failed" ? "destructive" : "outline"}>{r.status}</Badge>
                    <span className="flex-1 truncate text-muted-foreground">{new Date(r.started_at).toLocaleString()}</span>
                    <span className="tabular-nums">{r.status === "completed" ? `${r.matched_count ?? 0} match groups · ${r.exception_count ?? 0} exception items` : "—"}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {d.exceptions_trend.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Exceptions trend (30 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <Sparkbars data={d.exceptions_trend} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, hint }: { icon: any; label: string; value: number; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <Icon className="h-3.5 w-3.5" /> {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="font-display text-3xl font-semibold tabular-nums">{value}</div>
        {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function Sparkbars({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex h-24 items-end gap-1">
      {data.map((d) => (
        <div key={d.date} className="group relative flex-1" title={`${d.date}: ${d.count}`}>
          <div className="w-full rounded-sm bg-primary/80 transition-all hover:bg-primary" style={{ height: `${(d.count / max) * 100}%` }} />
        </div>
      ))}
    </div>
  );
}
