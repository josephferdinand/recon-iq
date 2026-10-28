import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getTenantHealthScore,
  getTenantHealthTrend,
  refreshTenantHealthScore,
} from "@/lib/tenant-health.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle2, RefreshCw, TrendingUp, Gauge, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

interface Props {
  tenantId: string;
}

function scoreTone(score: number): { ring: string; bg: string; text: string; label: string } {
  if (score >= 90) return { ring: "ring-emerald-500/40", bg: "bg-emerald-500/10", text: "text-emerald-700 dark:text-emerald-300", label: "Excellent" };
  if (score >= 75) return { ring: "ring-sky-500/40", bg: "bg-sky-500/10", text: "text-sky-700 dark:text-sky-300", label: "Healthy" };
  if (score >= 60) return { ring: "ring-amber-500/40", bg: "bg-amber-500/10", text: "text-amber-700 dark:text-amber-300", label: "Watch" };
  if (score >= 40) return { ring: "ring-orange-500/40", bg: "bg-orange-500/10", text: "text-orange-700 dark:text-orange-300", label: "At risk" };
  return { ring: "ring-destructive/40", bg: "bg-destructive/10", text: "text-destructive", label: "Critical" };
}

function Sparkline({ values, width = 220, height = 48 }: { values: number[]; width?: number; height?: number }) {
  if (!values?.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const step = width / Math.max(1, values.length - 1);
  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / span) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Score trend">
      <polyline points={points.join(" ")} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function TenantHealthWidget({ tenantId }: Props) {
  const qc = useQueryClient();
  const scoreFn = useServerFn(getTenantHealthScore);
  const trendFn = useServerFn(getTenantHealthTrend);
  const refreshFn = useServerFn(refreshTenantHealthScore);

  const scoreQ = useQuery({
    queryKey: ["tenant-health", tenantId],
    queryFn: () => scoreFn({ data: { tenant_id: tenantId } }),
  });
  const trendQ = useQuery({
    queryKey: ["tenant-health-trend", tenantId, 30],
    queryFn: () => trendFn({ data: { tenant_id: tenantId, days: 30 } }),
  });

  const refreshMut = useMutation({
    mutationFn: () => refreshFn({ data: { tenant_id: tenantId } }),
    onSuccess: () => {
      toast.success("Health score refreshed");
      qc.invalidateQueries({ queryKey: ["tenant-health"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not refresh health score"),
  });

  if (scoreQ.isLoading) {
    return (
      <Card className="border-border/60">
        <CardHeader><Skeleton className="h-5 w-40" /></CardHeader>
        <CardContent><Skeleton className="h-24 w-full" /></CardContent>
      </Card>
    );
  }

  const s = scoreQ.data;
  if (!s) {
    return (
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Reconciliation health</CardTitle>
          <CardDescription>No snapshot yet — refresh to compute your first score.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending} size="sm">
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Compute now
          </Button>
        </CardContent>
      </Card>
    );
  }

  const tone = scoreTone(Number(s.overall_score));
  const trend = (trendQ.data ?? []).map((r: { overall_score: number }) => r.overall_score);

  const subs: Array<{ key: string; label: string; value: number; tone: typeof tone }> = [
    { key: "match", label: "Match quality", value: Number(s.match_quality_score), tone },
    { key: "ex", label: "Exception volume", value: Number(s.exception_volume_score), tone },
    { key: "ttr", label: "Time-to-resolve", value: Number(s.time_to_resolve_score), tone },
    { key: "rules", label: "Rule coverage", value: Number(s.rule_coverage_score), tone },
    { key: "ai", label: "AI confidence", value: Number(s.ai_confidence_score), tone },
  ];

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base font-semibold">
            <Gauge className="mr-1.5 inline h-4 w-4 text-muted-foreground" />
            Reconciliation health
          </CardTitle>
          <CardDescription>
            Computed {new Date(s.computed_at).toLocaleString()} · {s.window_days}-day window
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refreshMut.mutate()}
          disabled={refreshMut.isPending}
        >
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${refreshMut.isPending ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className={`flex items-center gap-4 rounded-lg p-4 ring-1 ${tone.ring} ${tone.bg}`}>
          <div className={`flex h-16 w-16 items-center justify-center rounded-full ring-2 ${tone.ring} bg-background/70`}>
            <span className={`text-2xl font-bold tabular-nums ${tone.text}`}>
              {Math.round(Number(s.overall_score))}
            </span>
          </div>
          <div className="flex-1">
            <div className={`text-sm font-semibold ${tone.text}`}>{tone.label}</div>
            <div className="text-xs text-muted-foreground">
              {Number(s.runs_analyzed)} runs analysed · {Number(s.exceptions_open)} open exceptions
            </div>
          </div>
          <div className={`${tone.text}`}>
            <Sparkline values={trend.length ? trend : [Number(s.overall_score)]} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {subs.map((sub) => {
            const t = scoreTone(sub.value);
            return (
              <div key={sub.key} className={`rounded-md border p-2 ring-1 ${t.ring}`}>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{sub.label}</div>
                <div className={`text-lg font-semibold tabular-nums ${t.text}`}>{Math.round(sub.value)}</div>
              </div>
            );
          })}
        </div>

        {Array.isArray(s.top_issues) && s.top_issues.length > 0 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
              <ShieldAlert className="h-3.5 w-3.5" /> Top issues to fix
            </div>
            <ul className="space-y-1 text-xs">
              {s.top_issues.slice(0, 3).map((issue, i: number) => (
                <li key={i} className="flex items-start gap-2">
                  {issue.severity === "high" ? (
                    <AlertTriangle className="mt-0.5 h-3 w-3 text-destructive" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 h-3 w-3 text-muted-foreground" />
                  )}
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            <Badge variant="outline" className="mr-1">Match rate</Badge>
            {Math.round(Number(s.avg_match_rate) * 100)}%
          </span>
          <span>
            <Badge variant="outline" className="mr-1">Median TTR</Badge>
            {Math.round(Number(s.median_ttr_hours))}h
          </span>
          <span>
            <Badge variant="outline" className="mr-1">Rules</Badge>
            {Number(s.rules_active)}/{Number(s.rules_total)} active
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <TrendingUp className="h-3 w-3" />
          Trend: 30-day rolling average
        </div>
      </CardContent>
    </Card>
  );
}