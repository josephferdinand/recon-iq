import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getExceptionForecast, predictExceptionVolume } from "@/lib/exception-forecast.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, RefreshCw, Sparkles, TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";

interface Props {
  tenantId: string;
  horizonDays?: number;
}

function Sparkline({ values, width = 220, height = 48 }: { values: number[]; width?: number; height?: number }) {
  if (!values?.length) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(1, max - min);
  const step = width / Math.max(1, values.length - 1);
  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / span) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Forecast sparkline">
      <polyline points={points.join(" ")} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function ExceptionForecastWidget({ tenantId, horizonDays = 7 }: Props) {
  const qc = useQueryClient();
  const getFn = useServerFn(getExceptionForecast);
  const predictFn = useServerFn(predictExceptionVolume);

  const q = useQuery({
    queryKey: ["exception-forecast", tenantId, horizonDays],
    queryFn: () => getFn({ data: { tenant_id: tenantId, horizon_days: horizonDays } }),
  });

  const recomputeMut = useMutation({
    mutationFn: () => predictFn({ data: { tenant_id: tenantId, horizon_days: horizonDays } }),
    onSuccess: () => {
      toast.success("Forecast recomputed");
      qc.invalidateQueries({ queryKey: ["exception-forecast"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not recompute forecast"),
  });

  if (q.isLoading) {
    return (
      <Card className="border-border/60">
        <CardHeader><Skeleton className="h-5 w-48" /></CardHeader>
        <CardContent><Skeleton className="h-24 w-full" /></CardContent>
      </Card>
    );
  }

  const s = q.data;
  if (!s) {
    return (
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">
            <Sparkles className="mr-1.5 inline h-4 w-4 text-muted-foreground" />
            Exception forecast
          </CardTitle>
          <CardDescription>No forecast yet — predict to populate the model.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => recomputeMut.mutate()} disabled={recomputeMut.isPending} size="sm">
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Predict next {horizonDays} days
          </Button>
        </CardContent>
      </Card>
    );
  }

  const history = (s.history ?? []).map((p: { count: number }) => Number(p.count ?? 0));
  const future = (s.per_day ?? []).map((p: { expected: number }) => Number(p.expected ?? 0));

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base font-semibold">
            <Sparkles className="mr-1.5 inline h-4 w-4 text-muted-foreground" />
            Exception forecast
          </CardTitle>
          <CardDescription>
            Horizon: {horizonDays} days · computed {new Date(s.computed_at).toLocaleString()}
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => recomputeMut.mutate()}
          disabled={recomputeMut.isPending}
        >
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${recomputeMut.isPending ? "animate-spin" : ""}`} /> Recompute
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-center gap-4 rounded-lg border border-border/60 bg-background/40 p-4">
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Expected</div>
            <div className="text-3xl font-bold tabular-nums">{Math.round(Number(s.expected_count))}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              range {Math.round(Number(s.lower_count))}–{Math.round(Number(s.upper_count))}
            </div>
          </div>
          <div className="text-muted-foreground">
            <Sparkline values={[...history, ...future]} />
          </div>
        </div>

        {s.is_anomaly_active && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            Recent exception volume is {Number(s.anomaly_factor).toFixed(1)}× the 30-day rolling median — capacity forecast widened.
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 text-xs">
          <Stat label="Daily mean" value={Number(s.baseline_daily_mean)} />
          <Stat label="Daily stddev" value={Number(s.baseline_daily_stddev)} />
          <Stat label="Rolling median" value={Number(s.rolling_median_30d)} />
        </div>

        <div className="overflow-hidden rounded-md border border-border/60">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Day</th>
                <th className="px-2 py-1.5 text-right font-medium">Expected</th>
                <th className="px-2 py-1.5 text-right font-medium">Range</th>
                <th className="px-2 py-1.5 text-right font-medium">DOW factor</th>
              </tr>
            </thead>
            <tbody>
              {(s.per_day ?? []).map((day: { date: string; expected: number; lower: number; upper: number; dow_factor: number }, i: number) => (
                <tr key={i} className="border-t border-border/40">
                  <td className="px-2 py-1.5 font-mono">{day.date}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{Math.round(Number(day.expected))}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                    {Math.round(Number(day.lower))}–{Math.round(Number(day.upper))}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    <Badge variant="outline">{Number(day.dow_factor).toFixed(2)}×</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <TrendingDown className="h-3 w-3" /> Last 30 days history
          </span>
          <span className="flex items-center gap-1">
            <TrendingUp className="h-3 w-3" /> Next {horizonDays} days forecast
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/60 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{Math.round(value * 10) / 10}</div>
    </div>
  );
}