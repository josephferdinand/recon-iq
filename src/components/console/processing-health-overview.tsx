/**
 * ProcessingHealthOverview — top-of-console composite health for a tenant.
 * Aggregates shard reliability, silo SLA compliance, and chaos drill outcomes
 * into a single 0-100 score with per-signal breakdown and a per-executor strip.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  Cpu,
  Layers,
  FlaskConical,
  CheckCircle2,
  XCircle,
  HelpCircle,
} from "lucide-react";
import { getScaleHealthSummary } from "@/lib/scale-health.functions";

type Summary = Awaited<ReturnType<typeof getScaleHealthSummary>>;

function fmtSec(s: number | null | undefined): string {
  if (s == null) return "—";
  if (s === 0) return "0s";
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

function ComplianceChip({ ok }: { ok: boolean | null }) {
  if (ok === null) {
    return (
      <Badge variant="outline" className="text-[10px]">
        <HelpCircle className="h-3 w-3 mr-1" />
        No data
      </Badge>
    );
  }
  return ok ? (
    <Badge className="text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
      <CheckCircle2 className="h-3 w-3 mr-1" />
      Met
    </Badge>
  ) : (
    <Badge variant="destructive" className="text-[10px]">
      <XCircle className="h-3 w-3 mr-1" />
      Breached
    </Badge>
  );
}

export function ProcessingHealthOverview({ tenantId }: { tenantId: string }) {
  const fn = useServerFn(getScaleHealthSummary);
  const q = useQuery({
    queryKey: ["scale-health", tenantId],
    queryFn: () => fn({ data: { tenant_id: tenantId, window_days: 30 } }),
  });

  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.isError || !q.data) {
    return (
      <Card>
        <CardContent className="text-sm text-muted-foreground p-4">
          Unable to compute processing health right now.
        </CardContent>
      </Card>
    );
  }
  const s = q.data as Summary;

  const ringTone =
    s.signal === "positive"
      ? "text-emerald-800 dark:text-emerald-300 border-emerald-500/50 bg-emerald-500/10"
      : s.signal === "warning"
        ? "text-amber-600 dark:text-amber-400 border-amber-500/50 bg-amber-500/10"
        : "text-rose-600 dark:text-rose-400 border-rose-500/50 bg-rose-500/10";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" /> Processing health (last {s.window_days}d)
            </CardTitle>
            <CardDescription>
              Composite of shard reliability, silo SLA compliance, and chaos-drill outcomes for this
              tenant.
            </CardDescription>
          </div>
          <div
            className={`h-20 w-20 rounded-full border-4 flex flex-col items-center justify-center ${ringTone}`}
          >
            <span className="text-2xl font-bold leading-none">{s.score}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide">score</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {s.score_parts.map((p) => (
            <div key={p.key} className="rounded-md border p-2">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="capitalize">{p.key.replace("_", " ")}</span>
                <span className="font-mono">×{p.weight}</span>
              </div>
              <div className="mt-1 h-1.5 bg-muted rounded overflow-hidden">
                <div
                  className={
                    p.value >= 90
                      ? "h-full bg-emerald-500"
                      : p.value >= 70
                        ? "h-full bg-amber-500"
                        : "h-full bg-rose-500"
                  }
                  style={{ width: `${p.value}%` }}
                />
              </div>
              <p className="text-xs mt-1 font-medium">{p.value}%</p>
            </div>
          ))}
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          <div className="rounded-md border p-3 text-xs space-y-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <Cpu className="h-3 w-3" /> Shards
            </p>
            <p>
              <span className="font-semibold">{s.shards.total.toLocaleString()}</span> runs ·{" "}
              <span className={s.shards.failed > 0 ? "text-rose-600 dark:text-rose-400" : ""}>
                {s.shards.failed} failed
              </span>{" "}
              · p95 {fmtSec(s.shards.p95_sec)}
            </p>
            <p className="text-muted-foreground">
              {s.shards.rows_in.toLocaleString()} rows in · {s.shards.rows_matched.toLocaleString()}{" "}
              matched
            </p>
          </div>
          <div className="rounded-md border p-3 text-xs space-y-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <Layers className="h-3 w-3" /> Silo · <code>{s.silo.active_tier}</code>
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <span>
                RTO {fmtSec(s.silo.avg_rto_sec)} vs SLA ≤ {fmtSec(s.silo.sla_rto_sec)}
              </span>
              <ComplianceChip ok={s.silo.rto_compliance} />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span>
                RPO {fmtSec(s.silo.avg_rpo_sec)} vs SLA ≤ {fmtSec(s.silo.sla_rpo_sec)}
              </span>
              <ComplianceChip ok={s.silo.rpo_compliance} />
            </div>
          </div>
          <div className="rounded-md border p-3 text-xs space-y-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <FlaskConical className="h-3 w-3" /> Chaos
            </p>
            <p>
              <span className="font-semibold">{s.chaos.drill_count}</span> drills · pass rate{" "}
              <span className="font-semibold">{s.chaos.pass_rate}%</span>
            </p>
            <p className="text-muted-foreground truncate">
              {s.chaos.last_drill ? (
                <>
                  Last: <code>{s.chaos.last_drill.drill_code}</code> — {s.chaos.last_drill.status}
                </>
              ) : (
                "No drills in window."
              )}
            </p>
          </div>
        </div>

        {s.shards.by_executor.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
              By executor
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1">Executor</th>
                    <th className="text-right">Runs</th>
                    <th className="text-right">Failed</th>
                    <th className="text-right">Queued</th>
                    <th className="text-right">Rows in</th>
                    <th className="text-right">p95</th>
                    <th>Health</th>
                  </tr>
                </thead>
                <tbody>
                  {s.shards.by_executor.map((e) => {
                    const failRate = e.total ? e.failed / e.total : 0;
                    const bar =
                      failRate === 0
                        ? "bg-emerald-500"
                        : failRate < 0.1
                          ? "bg-amber-500"
                          : "bg-rose-500";
                    return (
                      <tr key={e.executor_code} className="border-t">
                        <td className="py-1">
                          <code>{e.executor_code}</code>
                        </td>
                        <td className="text-right font-mono">{e.total.toLocaleString()}</td>
                        <td className="text-right font-mono">{e.failed}</td>
                        <td className="text-right font-mono">{e.queued}</td>
                        <td className="text-right font-mono">{e.rows_in.toLocaleString()}</td>
                        <td className="text-right font-mono">{fmtSec(e.p95_sec)}</td>
                        <td>
                          <div className="h-1.5 bg-muted rounded overflow-hidden w-24">
                            <div
                              className={`h-full ${bar}`}
                              style={{ width: `${Math.round((1 - failRate) * 100)}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
