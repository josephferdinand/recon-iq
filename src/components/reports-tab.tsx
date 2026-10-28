import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getReportsCenter } from "@/lib/reports-center.functions";
import { reportsOverview } from "@/lib/reports.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
} from "recharts";
import {
  Activity, AlertTriangle, BookCheck, Bot, CheckCircle2, Download, FileBarChart, Lock,
  ScrollText, ShieldAlert, ShieldCheck, Sparkles, TrendingUp, XCircle,
} from "lucide-react";
import { exportCSV, exportJSON } from "@/lib/export-utils";

const PIE = ["hsl(var(--primary))", "hsl(190 80% 55%)", "hsl(265 75% 60%)", "hsl(340 75% 60%)", "hsl(42 95% 55%)", "hsl(160 60% 45%)", "hsl(20 90% 55%)", "hsl(220 14% 60%)"];
const SEV: Record<string, string> = { critical: "hsl(0 84% 60%)", high: "hsl(20 90% 55%)", medium: "hsl(42 95% 55%)", low: "hsl(160 60% 45%)", info: "hsl(220 14% 60%)" };

function num(v: number | null | undefined) {
  if (v == null) return "—";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "k";
  return String(v);
}

function Kpi({ icon: Icon, label, value, suffix, tone = "default", hint }: any) {
  const tones: Record<string, string> = {
    default: "from-muted/40 to-transparent text-foreground",
    success: "from-emerald-500/15 to-transparent text-emerald-600 dark:text-emerald-400",
    warning: "from-amber-500/15 to-transparent text-amber-600 dark:text-amber-400",
    danger: "from-rose-500/15 to-transparent text-rose-600 dark:text-rose-400",
    info: "from-sky-500/15 to-transparent text-sky-600 dark:text-sky-400",
    accent: "from-violet-500/15 to-transparent text-violet-600 dark:text-violet-400",
  };
  return (
    <Card className="relative overflow-hidden">
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${tones[tone]}`} />
      <CardContent className="relative p-4">
        <div className="flex items-center justify-between">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-background/70 ring-1 ring-border backdrop-blur">
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-3 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-0.5 flex items-baseline gap-1">
          <span className="font-display text-2xl font-semibold tabular-nums">{value}</span>
          {suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
        </div>
        {hint ? <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

const REPORT_TABS = [
  { key: "operations", label: "Operations", icon: Activity },
  { key: "match", label: "Match rates", icon: TrendingUp },
  { key: "trends", label: "Trend analysis", icon: FileBarChart },
  { key: "risk", label: "Risk", icon: ShieldAlert },
  { key: "ai", label: "AI usage", icon: Bot },
  { key: "security", label: "Security", icon: Lock },
  { key: "compliance", label: "Compliance", icon: ShieldCheck },
  { key: "audit", label: "Audit", icon: ScrollText },
  { key: "custom", label: "Custom", icon: Sparkles },
] as const;

export function ReportsTab({ tenantId }: { tenantId: string }) {
  const [days, setDays] = useState(30);
  const fn = useServerFn(getReportsCenter);
  const legacyFn = useServerFn(reportsOverview);
  const q = useQuery({
    queryKey: ["reports-center", tenantId, days],
    queryFn: () => fn({ data: { tenant_id: tenantId, days } }),
  });
  const legacy = useQuery({
    queryKey: ["reports-legacy", tenantId, days],
    queryFn: () => legacyFn({ data: { tenant_id: tenantId, days } }),
  });

  if (q.isLoading || !q.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-3 md:grid-cols-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-28" />)}</div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const d = q.data;
  const exportAll = () => exportJSON([d], `fvi-reports-${days}d-${new Date().toISOString().slice(0, 10)}.json`);

  return (
    <div className="space-y-5">
      {/* HERO — Heritage Operational (Direction C) */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-900/10 bg-[linear-gradient(135deg,#0b1d3a_0%,#13294b_55%,#0b1d3a_100%)] p-6 text-slate-100 shadow-xl">
        {/* Gold corner rule */}
        <div className="pointer-events-none absolute left-0 top-0 h-1.5 w-full bg-gradient-to-r from-amber-300/0 via-amber-300/80 to-amber-300/0" />
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-amber-300/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-16 -bottom-20 h-56 w-56 rounded-full bg-sky-400/10 blur-3xl" />

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            {/* Monogram */}
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-amber-300/15 ring-1 ring-amber-300/40">
              <span className="font-display text-2xl font-semibold tracking-tight text-amber-200">RQ</span>
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-amber-200">
                <FileBarChart className="h-3 w-3" /> Pre-flight briefing · Reports
              </div>
              <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight text-white">
                Flight-Deck Analytics
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-300">
                Operations · Match rates · Trends · Risk · AI usage · Security · Compliance · Audit · Custom builder
              </p>
              <p className="mt-0.5 text-[11px] uppercase tracking-wider text-slate-400">
                Generated {new Date(d.generated_at).toLocaleString()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger className="w-36 border-amber-300/30 bg-white/5 text-slate-100 hover:bg-white/10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="60">Last 60 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="180">Last 180 days</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={exportAll}
              className="border-amber-300/40 bg-amber-300/10 text-amber-100 hover:bg-amber-300/20 hover:text-white">
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export brief
            </Button>
          </div>
        </div>

        {/* Hero KPI strip — pilot checklist tiles */}
        <div className="relative mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: TrendingUp, callsign: "ALPHA · MATCH-RATE", value: d.operations.match_rate_pct, suffix: "%", tone: "emerald", hint: `${num(d.operations.matched)} matched / ${num(d.operations.matched + d.operations.exceptions)}` },
            { icon: ShieldAlert, callsign: "BRAVO · RISK", value: d.risk.score, suffix: "/100", tone: d.risk.score > 60 ? "rose" : d.risk.score > 30 ? "amber" : "emerald", hint: `${d.risk.open_breaks} open · ${d.risk.overdue} overdue` },
            { icon: ShieldCheck, callsign: "CHARLIE · COMPLIANCE", value: d.compliance.score, suffix: "%", tone: d.compliance.score >= 80 ? "emerald" : "amber", hint: `${d.compliance.checks.filter((c: any) => c.ok).length}/${d.compliance.checks.length} controls met` },
            { icon: Bot, callsign: "DELTA · AI SPEND", value: `$${d.ai_usage.cost_usd.toFixed(2)}`, suffix: "", tone: "violet", hint: `${num(d.ai_usage.total_tokens)} tokens · ${d.ai_usage.calls} calls` },
          ].map((k, i) => {
            const toneRing: Record<string, string> = {
              emerald: "ring-emerald-300/40 text-emerald-200",
              rose: "ring-rose-300/40 text-rose-200",
              amber: "ring-amber-300/40 text-amber-200",
              violet: "ring-violet-300/40 text-violet-200",
            };
            return (
              <div key={i} className="group relative overflow-hidden rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm transition-colors hover:bg-white/10">
                <div className="absolute left-0 top-0 h-full w-0.5 bg-amber-300/60" />
                <div className="flex items-center gap-2 text-[10px] font-medium tracking-[0.18em] text-slate-400">
                  <span className={`flex h-5 w-5 items-center justify-center rounded ring-1 ${toneRing[k.tone]} bg-white/5`}>
                    <k.icon className="h-3 w-3" />
                  </span>
                  {k.callsign}
                </div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="font-display text-3xl font-semibold tabular-nums text-white">{k.value}</span>
                  {k.suffix && <span className="text-xs text-slate-400">{k.suffix}</span>}
                </div>
                <div className="mt-1 text-[11px] text-slate-400">{k.hint}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* TABS */}
      <Tabs defaultValue="operations">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/40 p-1">
          {REPORT_TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* OPERATIONS */}
        <TabsContent value="operations" className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Kpi icon={Activity} label="Runs" value={d.operations.runs} hint={`${d.operations.success} success · ${d.operations.failed} failed`} />
            <Kpi icon={CheckCircle2} label="Avg runtime" value={d.operations.avg_runtime_sec} suffix="s" tone="info" />
            <Kpi icon={Sparkles} label="Active schedules" value={d.operations.active_schedules} tone="info" />
            <Kpi icon={AlertTriangle} label="Open tickets" value={d.operations.tickets_open} tone={d.operations.tickets_open ? "warning" : "default"} />
          </div>
          {legacy.data ? <OperationsLegacyCharts d={legacy.data} /> : <Skeleton className="h-64" />}
          <ExportBar onCsv={() => legacy.data && exportCSV(legacy.data.trend, `fvi-operations-${days}d.csv`)} onJson={() => exportJSON([d.operations], `fvi-operations-${days}d.json`)} />
        </TabsContent>

        {/* MATCH RATES */}
        <TabsContent value="match" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Match rate over time</CardTitle>
              <CardDescription>Matched vs exceptions per day with rolling rate</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={d.match_rates.trend}>
                  <defs>
                    <linearGradient id="mr1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.6} /><stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} /></linearGradient>
                    <linearGradient id="mr2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(20 90% 55%)" stopOpacity={0.5} /><stop offset="100%" stopColor="hsl(20 90% 55%)" stopOpacity={0.05} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="day" tickFormatter={(v) => v.slice(5)} fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Legend />
                  <Area type="monotone" dataKey="matched" stackId="1" stroke="hsl(var(--primary))" fill="url(#mr1)" />
                  <Area type="monotone" dataKey="exceptions" stackId="1" stroke="hsl(20 90% 55%)" fill="url(#mr2)" />
                  <Line type="monotone" dataKey="rate" stroke="hsl(160 60% 45%)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <ExportBar onCsv={() => exportCSV(d.match_rates.trend, `fvi-match-rate-${days}d.csv`)} onJson={() => exportJSON(d.match_rates.trend, `fvi-match-rate-${days}d.json`)} />
        </TabsContent>

        {/* TRENDS */}
        <TabsContent value="trends" className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Kpi icon={TrendingUp} label="Exceptions WoW" value={`${d.trends.wow_exceptions_pct > 0 ? "+" : ""}${d.trends.wow_exceptions_pct}`} suffix="%" tone={d.trends.wow_exceptions_pct > 0 ? "danger" : "success"} hint={`${d.trends.current} vs ${d.trends.previous} prior period`} />
            <Kpi icon={Activity} label="Current period" value={num(d.trends.current)} />
            <Kpi icon={Activity} label="Previous period" value={num(d.trends.previous)} />
          </div>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Run volume & match-rate trend</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={d.match_rates.trend}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="day" tickFormatter={(v) => v.slice(5)} fontSize={11} />
                  <YAxis yAxisId="l" fontSize={11} />
                  <YAxis yAxisId="r" orientation="right" fontSize={11} />
                  <Tooltip /><Legend />
                  <Line yAxisId="l" type="monotone" dataKey="runs" stroke="hsl(265 75% 60%)" strokeWidth={2} dot={false} />
                  <Line yAxisId="r" type="monotone" dataKey="rate" stroke="hsl(160 60% 45%)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* RISK */}
        <TabsContent value="risk" className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Kpi icon={ShieldAlert} label="Risk score" value={d.risk.score} suffix="/100" tone={d.risk.score > 60 ? "danger" : d.risk.score > 30 ? "warning" : "success"} />
            <Kpi icon={AlertTriangle} label="Open breaks" value={d.risk.open_breaks} tone="warning" />
            <Kpi icon={XCircle} label="Overdue" value={d.risk.overdue} tone={d.risk.overdue ? "danger" : "default"} />
            <Kpi icon={AlertTriangle} label="Critical + High" value={d.risk.critical + d.risk.high} tone={(d.risk.critical + d.risk.high) ? "danger" : "default"} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Severity distribution</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={d.risk.severity} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                      {d.risk.severity.map((s: any) => <Cell key={s.name} fill={SEV[s.name] ?? "hsl(var(--muted-foreground))"} />)}
                    </Pie>
                    <Tooltip /><Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Top root causes</CardTitle></CardHeader>
              <CardContent>
                {d.risk.top_root_causes.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No root causes captured yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={d.risk.top_root_causes} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis type="number" fontSize={11} />
                      <YAxis type="category" dataKey="name" fontSize={11} width={140} />
                      <Tooltip />
                      <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
          <ExportBar onCsv={() => exportCSV(d.risk.top_root_causes, `fvi-risk-rootcauses-${days}d.csv`)} onJson={() => exportJSON([d.risk], `fvi-risk-${days}d.json`)} />
        </TabsContent>

        {/* AI USAGE */}
        <TabsContent value="ai" className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Kpi icon={Bot} label="Total spend" value={`$${d.ai_usage.cost_usd.toFixed(2)}`} tone="accent" />
            <Kpi icon={Sparkles} label="Tokens in" value={num(d.ai_usage.tokens_in)} />
            <Kpi icon={Sparkles} label="Tokens out" value={num(d.ai_usage.tokens_out)} />
            <Kpi icon={Activity} label="AI calls" value={num(d.ai_usage.calls)} tone="info" />
          </div>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Spend & tokens over time</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={d.ai_usage.trend}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="day" tickFormatter={(v) => v.slice(5)} fontSize={11} />
                  <YAxis yAxisId="l" fontSize={11} />
                  <YAxis yAxisId="r" orientation="right" fontSize={11} />
                  <Tooltip /><Legend />
                  <Line yAxisId="l" type="monotone" dataKey="cost" stroke="hsl(265 75% 60%)" strokeWidth={2} dot={false} name="Cost (USD)" />
                  <Line yAxisId="r" type="monotone" dataKey="tokens" stroke="hsl(190 80% 55%)" strokeWidth={2} dot={false} name="Tokens" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">By model</CardTitle></CardHeader>
              <CardContent>
                {d.ai_usage.by_model.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No AI usage in window.</p> : (
                  <table className="w-full text-sm">
                    <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5">Model</th><th className="text-right">Calls</th><th className="text-right">Tokens</th><th className="text-right">Cost</th></tr></thead>
                    <tbody>
                      {d.ai_usage.by_model.map((m: any) => (
                        <tr key={m.name} className="border-b last:border-0">
                          <td className="py-1.5 font-mono text-xs">{m.name}</td>
                          <td className="text-right tabular-nums">{m.calls}</td>
                          <td className="text-right tabular-nums">{num(m.tokens)}</td>
                          <td className="text-right tabular-nums">${m.cost.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">By scope</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={d.ai_usage.by_scope} dataKey="value" nameKey="name" outerRadius={90}>
                      {d.ai_usage.by_scope.map((_: any, i: number) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
                    </Pie>
                    <Tooltip /><Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
          <ExportBar onCsv={() => exportCSV(d.ai_usage.by_model, `fvi-ai-models-${days}d.csv`)} onJson={() => exportJSON([d.ai_usage], `fvi-ai-usage-${days}d.json`)} />
        </TabsContent>

        {/* SECURITY */}
        <TabsContent value="security" className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Kpi icon={ShieldAlert} label="Security events" value={num(d.security.events_total)} tone="info" />
            <Kpi icon={Lock} label="Failed logins / lockouts" value={d.security.failed_logins} tone={d.security.failed_logins ? "warning" : "success"} />
            <Kpi icon={Activity} label="Unique IPs" value={d.security.unique_ips} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Event types</CardTitle></CardHeader>
              <CardContent>
                {d.security.type_mix.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No security events.</p> : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={d.security.type_mix} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis type="number" fontSize={11} />
                      <YAxis type="category" dataKey="name" fontSize={11} width={140} />
                      <Tooltip />
                      <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Severity mix</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={d.security.severity_mix} dataKey="value" nameKey="name" outerRadius={90}>
                      {d.security.severity_mix.map((s: any) => <Cell key={s.name} fill={SEV[s.name] ?? "hsl(var(--muted-foreground))"} />)}
                    </Pie>
                    <Tooltip /><Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
          <ExportBar onCsv={() => exportCSV(d.security.type_mix, `fvi-security-events-${days}d.csv`)} onJson={() => exportJSON([d.security], `fvi-security-${days}d.json`)} />
        </TabsContent>

        {/* COMPLIANCE */}
        <TabsContent value="compliance" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm">Control readiness</CardTitle>
                  <CardDescription>SOC 2 · ISO 27001 · GDPR</CardDescription>
                </div>
                <Badge variant={d.compliance.score >= 80 ? "default" : "outline"} className="text-base">{d.compliance.score}%</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <Progress value={d.compliance.score} className="mb-4" />
              <div className="grid gap-2 md:grid-cols-2">
                {d.compliance.checks.map((c: any) => (
                  <div key={c.id} className={`flex items-start gap-3 rounded-lg border p-3 ${c.ok ? "bg-emerald-500/5 border-emerald-500/30" : "bg-rose-500/5 border-rose-500/30"}`}>
                    {c.ok
                      ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />}
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{c.name}</div>
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{c.control}</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <ExportBar onCsv={() => exportCSV(d.compliance.checks, `fvi-compliance-${days}d.csv`)} onJson={() => exportJSON([d.compliance], `fvi-compliance-${days}d.json`)} />
        </TabsContent>

        {/* AUDIT */}
        <TabsContent value="audit" className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Kpi icon={ScrollText} label="Audit events" value={num(d.audit.events_total)} tone="info" />
            <Kpi icon={BookCheck} label="Distinct actions" value={d.audit.top_actions.length} />
            <Kpi icon={Activity} label="Distinct actors" value={d.audit.top_actors.length} />
          </div>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Activity over time</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={d.audit.trend}>
                  <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} /><stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="day" tickFormatter={(v) => v.slice(5)} fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Area type="monotone" dataKey="events" stroke="hsl(var(--primary))" fill="url(#ag)" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Top actions</CardTitle></CardHeader>
              <CardContent>
                {d.audit.top_actions.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No audit events.</p> : (
                  <ul className="space-y-1.5 text-sm">
                    {d.audit.top_actions.map((a: any) => (
                      <li key={a.name} className="flex items-center justify-between rounded-md border bg-card/40 px-2.5 py-1.5">
                        <span className="font-mono text-xs">{a.name}</span>
                        <Badge variant="secondary" className="tabular-nums">{a.value}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Top actors</CardTitle></CardHeader>
              <CardContent>
                {d.audit.top_actors.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No audit events.</p> : (
                  <ul className="space-y-1.5 text-sm">
                    {d.audit.top_actors.map((a: any) => (
                      <li key={a.name} className="flex items-center justify-between rounded-md border bg-card/40 px-2.5 py-1.5">
                        <span className="truncate">{a.name}</span>
                        <Badge variant="secondary" className="tabular-nums">{a.value}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
          <ExportBar onCsv={() => exportCSV(d.audit.top_actions, `fvi-audit-actions-${days}d.csv`)} onJson={() => exportJSON([d.audit], `fvi-audit-${days}d.json`)} />
        </TabsContent>

        {/* CUSTOM */}
        <TabsContent value="custom" className="mt-4">
          <CustomReportBuilder data={d} days={days} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ExportBar({ onCsv, onJson }: { onCsv: () => void; onJson: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="outline" onClick={onCsv}><Download className="mr-1.5 h-3.5 w-3.5" /> CSV</Button>
      <Button size="sm" variant="outline" onClick={onJson}><Download className="mr-1.5 h-3.5 w-3.5" /> JSON</Button>
    </div>
  );
}

function OperationsLegacyCharts({ d }: { d: any }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Ageing of open breaks</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={d.aging}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="bucket" fontSize={11} />
              <YAxis fontSize={11} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">MTTR by priority (hours)</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={d.mttr}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="priority" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Bar dataKey="hours" fill="hsl(265 75% 60%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Top rekons by exception volume</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={d.top_recons} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis type="number" fontSize={11} />
              <YAxis type="category" dataKey="name" fontSize={11} width={150} />
              <Tooltip /><Legend />
              <Bar dataKey="matched" stackId="a" fill="hsl(160 60% 45%)" />
              <Bar dataKey="exceptions" stackId="a" fill="hsl(20 90% 55%)" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------- CUSTOM REPORT BUILDER ---------- */

const METRIC_OPTIONS = [
  { key: "operations.runs", label: "Total runs" },
  { key: "operations.success", label: "Successful runs" },
  { key: "operations.failed", label: "Failed runs" },
  { key: "operations.match_rate_pct", label: "Match rate %" },
  { key: "operations.matched", label: "Matched records" },
  { key: "operations.exceptions", label: "Exceptions" },
  { key: "operations.avg_runtime_sec", label: "Avg runtime (s)" },
  { key: "operations.tickets_open", label: "Open tickets" },
  { key: "risk.score", label: "Risk score" },
  { key: "risk.open_breaks", label: "Open breaks" },
  { key: "risk.overdue", label: "Overdue breaks" },
  { key: "risk.critical", label: "Critical breaks" },
  { key: "risk.high", label: "High breaks" },
  { key: "ai_usage.cost_usd", label: "AI cost (USD)" },
  { key: "ai_usage.total_tokens", label: "AI total tokens" },
  { key: "ai_usage.calls", label: "AI call count" },
  { key: "security.events_total", label: "Security events" },
  { key: "security.failed_logins", label: "Failed logins" },
  { key: "compliance.score", label: "Compliance %" },
  { key: "audit.events_total", label: "Audit events" },
];

function getPath(obj: any, path: string) {
  return path.split(".").reduce((a, k) => (a == null ? a : a[k]), obj);
}

function CustomReportBuilder({ data, days }: { data: any; days: number }) {
  const [title, setTitle] = useState("My custom report");
  const [picked, setPicked] = useState<string[]>([
    "operations.match_rate_pct", "risk.score", "ai_usage.cost_usd", "compliance.score",
  ]);
  const rows = useMemo(
    () => picked.map((k) => {
      const opt = METRIC_OPTIONS.find((m) => m.key === k);
      return { key: k, label: opt?.label ?? k, value: getPath(data, k) };
    }),
    [picked, data],
  );
  const toggle = (k: string) => setPicked((p) => p.includes(k) ? p.filter((x) => x !== k) : [...p, k]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm"><Sparkles className="h-4 w-4 text-primary" /> Custom report builder</CardTitle>
        <CardDescription>Pick the KPIs you care about, name your report, and export as CSV or JSON.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:max-w-md">
          <Label htmlFor="rname">Report title</Label>
          <Input id="rname" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Available metrics</div>
          <div className="flex flex-wrap gap-1.5">
            {METRIC_OPTIONS.map((m) => {
              const on = picked.includes(m.key);
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => toggle(m.key)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${on ? "border-primary bg-primary/10 text-primary" : "bg-card hover:bg-muted"}`}
                >
                  {on ? "✓ " : ""}{m.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border bg-card/40">
          <div className="border-b px-4 py-3">
            <div className="font-display text-lg font-semibold">{title}</div>
            <div className="text-xs text-muted-foreground">Window: last {days} days · generated {new Date(data.generated_at).toLocaleString()}</div>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="px-4 py-2">Metric</th><th className="px-4 py-2 text-right">Value</th></tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={2} className="px-4 py-6 text-center text-muted-foreground">Pick at least one metric above.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.key} className="border-b last:border-0">
                  <td className="px-4 py-2">{r.label}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{r.value ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => exportCSV(rows, `${title.replace(/\s+/g, "_")}.csv`)}><Download className="mr-1.5 h-3.5 w-3.5" /> CSV</Button>
          <Button size="sm" variant="outline" onClick={() => exportJSON([{ title, window_days: days, generated_at: data.generated_at, metrics: rows }], `${title.replace(/\s+/g, "_")}.json`)}><Download className="mr-1.5 h-3.5 w-3.5" /> JSON</Button>
        </div>
      </CardContent>
    </Card>
  );
}
