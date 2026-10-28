import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getWorkspaceAnalytics } from "@/lib/dashboard.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, XAxis, YAxis,
} from "recharts";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Bot, Database, GitBranch,
  LifeBuoy, Sparkles, Target, Timer, TrendingUp, Zap,
} from "lucide-react";

const WINDOWS = [
  { label: "7d", value: 7 },
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
];

const SEVERITY_COLOR: Record<string, string> = {
  critical: "hsl(0 84% 60%)",
  high: "hsl(20 90% 55%)",
  medium: "hsl(42 95% 55%)",
  low: "hsl(160 60% 45%)",
};

const DATA_SOURCE_COLOR_TOKENS: Record<string, string> = {
  csv: "--data-source-csv",
  xlsx: "--data-source-xlsx",
  json: "--data-source-json",
  api: "--data-source-api",
  database: "--data-source-database",
  manual: "--data-source-manual",
};

export function getDataSourceColor(sourceType: string) {
  const token = DATA_SOURCE_COLOR_TOKENS[sourceType.trim().toLowerCase()] ?? "--data-source-other";
  return `var(${token})`;
}

function num(v: number) {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "k";
  return String(v);
}

function Delta({ value, suffix = "" }: { value: number | null; suffix?: string }) {
  if (value === null) return <span className="text-xs text-muted-foreground">— no data</span>;
  if (!value) return <span className="text-xs text-muted-foreground">— flat</span>;
  const up = value > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
      <Icon className="h-3 w-3" />{Math.abs(value)}{suffix}
    </span>
  );
}

function HeroKpi({
  icon: Icon, label, value, suffix, delta, tone = "primary", hint,
}: {
  icon: any; label: string; value: string | number; suffix?: string; delta?: number | null; tone?: "primary" | "warning" | "success" | "info"; hint?: string;
}) {
  const tones: Record<string, string> = {
    primary: "from-primary/15 to-primary/0 ring-primary/20 text-primary",
    warning: "from-amber-500/15 to-amber-500/0 ring-amber-500/20 text-amber-600 dark:text-amber-400",
    success: "from-emerald-500/15 to-emerald-500/0 ring-emerald-500/20 text-emerald-600 dark:text-emerald-400",
    info: "from-sky-500/15 to-sky-500/0 ring-sky-500/20 text-sky-600 dark:text-sky-400",
  };
  return (
    <Card className="group relative overflow-hidden border-border/60 shadow-sm transition hover:shadow-md">
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${tones[tone]} opacity-70`} />
      <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-gradient-to-br from-foreground/[0.04] to-transparent" />
      <CardContent className="relative p-5">
        <div className="flex items-center justify-between">
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-background/70 ring-1 backdrop-blur ${tones[tone].split(" ").slice(-1)[0]}`}>
            <Icon className="h-4 w-4" />
          </div>
          {delta !== undefined ? <Delta value={delta} suffix={suffix === "%" ? "pp" : ""} /> : null}
        </div>
        <div className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-0.5 flex items-baseline gap-1">
          <span className="font-display text-3xl font-semibold tabular-nums">{value}</span>
          {suffix ? <span className="text-sm text-muted-foreground">{suffix}</span> : null}
        </div>
        {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

const cfg: ChartConfig = {
  matched: { label: "Input records in matched groups", color: "hsl(var(--primary))" },
  unmatched: { label: "Not matched input records", color: "hsl(20 90% 55%)" },
  rate: { label: "Record match rate %", color: "hsl(160 60% 45%)" },
  opened: { label: "Opened", color: "hsl(20 90% 55%)" },
  resolved: { label: "Resolved", color: "hsl(160 60% 45%)" },
  cost: { label: "AI cost (USD)", color: "hsl(265 75% 60%)" },
  tokens: { label: "Tokens", color: "hsl(190 80% 55%)" },
};

export function WorkspaceDashboard({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const [windowDays, setWindowDays] = useState<number>(30);
  const fn = useServerFn(getWorkspaceAnalytics);
  const q = useQuery({
    queryKey: ["workspace-analytics", tenantId, windowDays],
    queryFn: () => fn({ data: { tenant_id: tenantId, window_days: windowDays } }),
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
    gcTime: 5 * 60_000,
  });

  if (q.isError) {
    return (
      <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
        <div className="font-semibold">Workspace dashboard unavailable</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Dashboard data could not be loaded. Check your connection and try again.
        </p>
        <Button className="mt-3" size="sm" variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? "Retrying…" : "Retry"}
        </Button>
      </div>
    );
  }

  if (q.isLoading || !q.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <div className="grid gap-4 md:grid-cols-4">{[0,1,2,3].map(i => <Skeleton key={i} className="h-32" />)}</div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const d = q.data;

  return (
    <div className="space-y-6">
      {/* HERO */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-background p-6">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/15 blur-3xl" />
        <div className="pointer-events-none absolute -left-16 bottom-0 h-56 w-56 rounded-full bg-accent/20 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border bg-background/60 px-2.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground backdrop-blur">
              <Sparkles className="h-3 w-3 text-primary" /> Workspace intelligence
            </div>
            <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">{tenantName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              As of {new Date(d.as_of).toISOString().slice(11, 16)} UTC · {d.window_days} UTC calendar days · refreshes every 5 minutes
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg border bg-background/70 p-1 backdrop-blur">
            {WINDOWS.map((w) => (
              <Button
                key={w.value}
                size="sm"
                variant={w.value === windowDays ? "default" : "ghost"}
                className="h-7 px-3 text-xs"
                onClick={() => setWindowDays(w.value)}
              >
                {w.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="relative mt-6 grid gap-4 md:grid-cols-4">
          <HeroKpi icon={Target} label="Record match rate" value={d.kpis.match_rate.value === null ? "N/A" : d.kpis.match_rate.value} suffix={d.kpis.match_rate.value === null ? undefined : "%"} delta={d.kpis.match_rate.delta} tone="success" hint={d.totals.record_metrics_available ? `${num(d.totals.matched_records)} matched input records / ${num(d.totals.total_rows)} processed` : "Unavailable: completed runs lack complete record totals"} />
          <HeroKpi icon={Activity} label="Rekon runs" value={num(d.kpis.runs.value)} delta={d.kpis.runs.delta} tone="primary" hint={d.kpis.success_rate.value === null ? "N/A success rate · no completed or failed runs" : `${d.kpis.success_rate.value}% success of completed/failed runs`} />
          <HeroKpi icon={AlertTriangle} label="Current open exceptions" value={num(d.kpis.open_exceptions.value)} tone="warning" hint={d.kpis.mttr_hours.value === null ? "MTTR unavailable · no resolved cases in period" : `MTTR ${d.kpis.mttr_hours.value}h for cases resolved in period`} />
          <HeroKpi icon={Zap} label="Active schedules" value={d.kpis.schedules_active.value} tone="info" hint={`${d.kpis.data_sources.value} data sources`} />
        </div>
      </div>

      {/* Throughput + match-rate */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm"><TrendingUp className="h-4 w-4 text-primary" /> Input record coverage</CardTitle>
              <CardDescription>Input records in matched groups vs not matched input records; completed runs only</CardDescription>
            </div>
            <Badge variant="outline" className="font-mono text-[10px]">{d.window_days}d window</Badge>
          </CardHeader>
          <CardContent>
            {d.throughput.some((day: any) => day.completed > 0 && day.metricsComplete) ? <ChartContainer config={cfg} className="h-72 w-full">
              <ResponsiveContainer>
                <ComposedChart data={d.throughput} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gMatched" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.7} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="gUnmatched" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(20 90% 55%)" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="hsl(20 90% 55%)" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tickFormatter={(v) => v.slice(5)} fontSize={11} />
                  <YAxis yAxisId="records" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} tickFormatter={(value: number) => `${value}%`} tickLine={false} axisLine={false} fontSize={11} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area yAxisId="records" type="monotone" dataKey="matched" stackId="1" stroke="hsl(var(--primary))" fill="url(#gMatched)" strokeWidth={2} />
                  <Area yAxisId="records" type="monotone" dataKey="unmatched" stackId="1" stroke="hsl(20 90% 55%)" fill="url(#gUnmatched)" strokeWidth={2} />
                  <Line yAxisId="rate" type="monotone" dataKey="rate" stroke="hsl(160 60% 45%)" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartContainer> : <p className="py-16 text-center text-sm text-muted-foreground">No completed runs with valid input-record totals in this period.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4 text-amber-500" /> Severity mix</CardTitle>
            <CardDescription>Open exceptions by severity</CardDescription>
          </CardHeader>
          <CardContent>
            {d.severity.some((severity: any) => severity.value > 0) ? <ChartContainer config={cfg} className="h-56 w-full">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={d.severity} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                    {d.severity.map((s: any) => <Cell key={s.name} fill={SEVERITY_COLOR[s.name] ?? "hsl(var(--muted-foreground))"} />)}
                  </Pie>
                  <ChartTooltip content={<ChartTooltipContent />} />
                </PieChart>
              </ResponsiveContainer>
            </ChartContainer> : <p className="py-10 text-center text-sm text-muted-foreground">No open exceptions at this snapshot.</p>}
            <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs">
              {d.severity.map((s: any) => (
                <div key={s.name} className="flex items-center justify-between rounded-md border bg-card/40 px-2 py-1">
                  <span className="flex items-center gap-1.5 capitalize">
                    <span className="h-2 w-2 rounded-full" style={{ background: SEVERITY_COLOR[s.name] }} />
                    {s.name}
                  </span>
                  <span className="font-semibold tabular-nums">{s.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Exception flow + ageing */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><Activity className="h-4 w-4 text-primary" /> Exception flow</CardTitle>
            <CardDescription>Opened vs resolved per day — narrowing gap = healthy</CardDescription>
          </CardHeader>
          <CardContent>
            {d.exceptions_flow.some((day: any) => day.opened > 0 || day.resolved > 0) ? <ChartContainer config={cfg} className="h-60 w-full">
              <ResponsiveContainer>
                <BarChart data={d.exceptions_flow} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tickFormatter={(v) => v.slice(5)} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="opened" fill="hsl(20 90% 55%)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="resolved" fill="hsl(160 60% 45%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer> : <p className="py-12 text-center text-sm text-muted-foreground">No exceptions opened or resolved in this period.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><Timer className="h-4 w-4 text-amber-500" /> Ageing of open breaks</CardTitle>
            <CardDescription>Stale buckets need attention</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {d.ageing.map((b: any, i: number) => {
                const max = Math.max(...d.ageing.map((x: any) => x.value), 1);
                const pct = (b.value / max) * 100;
                const danger = i >= 3;
                return (
                  <div key={b.name}>
                    <div className="mb-0.5 flex items-center justify-between text-xs">
                      <span className="font-medium text-muted-foreground">{b.name}</span>
                      <span className="tabular-nums">{b.value}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full transition-all ${danger ? "bg-gradient-to-r from-amber-500 to-rose-500" : "bg-gradient-to-r from-primary to-primary/60"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top rekons + distributions */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><GitBranch className="h-4 w-4 text-primary" /> Top rekons by open breaks</CardTitle>
            <CardDescription>Where to focus your operators first</CardDescription>
          </CardHeader>
          <CardContent>
            {d.top_recons.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No open breaks — nicely done.</p>
            ) : (
              <div className="space-y-2">
                {d.top_recons.map((r: any, i: number) => {
                  const max = d.top_recons[0].open;
                  return (
                    <div key={r.id} className="group rounded-lg border bg-card/40 p-3 transition hover:bg-card">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 font-mono text-xs font-semibold text-primary">{i + 1}</span>
                          <div>
                            <div className="text-sm font-medium">{r.name}</div>
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{r.type}</div>
                          </div>
                        </div>
                        <Badge variant="secondary" className="tabular-nums">{r.open} open</Badge>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-gradient-to-r from-primary via-primary/80 to-accent" style={{ width: `${(r.open / max) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="[--data-source-csv:#1e3a5f] [--data-source-xlsx:#765817] [--data-source-json:#1e6f8c] [--data-source-api:#3b5f87] [--data-source-database:#10b981] [--data-source-manual:#5c4f36] [--data-source-other:#6b7280] dark:[--data-source-csv:#6be5ff] dark:[--data-source-xlsx:#f2ddb4] dark:[--data-source-json:#b3f1ff] dark:[--data-source-api:#f6f8fc] dark:[--data-source-database:#66e5b0] dark:[--data-source-manual:#f5c46b] dark:[--data-source-other:#9ca3af]">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm"><Database className="h-4 w-4 text-sky-500" /> Data source mix</CardTitle>
            </CardHeader>
            <CardContent>
              {d.ds_mix.length > 0 ? <ChartContainer config={cfg} className="h-40 w-full">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={d.ds_mix} dataKey="value" nameKey="name" outerRadius={70}>
                      {d.ds_mix.map((s: any) => <Cell key={s.name} fill={getDataSourceColor(s.name)} stroke="var(--background)" strokeWidth={2} />)}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartContainer> : <p className="py-8 text-center text-sm text-muted-foreground">No data sources are available in this workspace.</p>}
              <div role="list" aria-label="Data source types and counts" className="mt-1 flex flex-wrap gap-1 text-xs">
                {d.ds_mix.map((s: any) => (
                  <span role="listitem" key={s.name} className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5">
                    <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: getDataSourceColor(s.name) }} />
                    {s.name} · {s.value}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm"><LifeBuoy className="h-4 w-4 text-rose-500" /> Open tickets</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                {d.tickets_by_priority.map((p: any) => (
                  <div key={p.name} className="rounded-lg border bg-card/40 p-2 text-center">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{p.name}</div>
                    <div className="font-display text-xl font-semibold tabular-nums">{p.value}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* AI + recent runs */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><Bot className="h-4 w-4 text-violet-500" /> AI usage & spend</CardTitle>
            <CardDescription>
              {num(d.ai.tokens_in + d.ai.tokens_out)} tokens · ${d.ai.cost_usd.toFixed(2)} in the window
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={cfg} className="h-56 w-full">
              <ResponsiveContainer>
                <LineChart data={d.ai.series} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tickFormatter={(v) => v.slice(5)} fontSize={11} />
                  <YAxis yAxisId="left" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} fontSize={11} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line yAxisId="left" type="monotone" dataKey="cost" stroke="hsl(265 75% 60%)" strokeWidth={2} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="tokens" stroke="hsl(190 80% 55%)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><Activity className="h-4 w-4 text-primary" /> Recent runs</CardTitle>
            <CardDescription>Latest 8 across all rekons</CardDescription>
          </CardHeader>
          <CardContent>
            {d.recent_runs.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">No runs in the selected period. Completed runs will appear here with their recorded totals.</p>
            ) : (
              <ul className="space-y-1.5">
                {d.recent_runs.map((r: any) => {
                  const runSummary = r.record_metrics_available
                    ? `${r.record_match_rate}% · ${num(r.matched_records)}/${num(r.record_total)} input records`
                    : `${num(r.matched_count ?? 0)} match groups · ${num(r.exception_count ?? 0)} exception items`;
                  return (
                    <li key={r.id} className="rounded-md border bg-card/40 p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{r.recon_name}</span>
                        <Badge variant={r.status === "completed" ? "default" : r.status === "failed" ? "destructive" : "outline"} className="text-[10px]">
                          {r.status}
                        </Badge>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{new Date(r.started_at).toLocaleString()}</span>
                        <span className="tabular-nums">{runSummary}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
