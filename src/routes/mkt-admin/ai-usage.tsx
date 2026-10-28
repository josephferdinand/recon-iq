import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getPlatformAiUsage } from "@/lib/ai-usage-analytics.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { USER_FACING_ERRORS, userFacingErrorKind } from "@/lib/user-facing-errors";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BadgeIndianRupee,
  Bot,
  Building2,
  Coins,
  Cpu,
  DollarSign,
  Download,
  Info,
  Lightbulb,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Zap,
  AlertTriangle,
  ShieldAlert,
} from "lucide-react";

export const Route = createFileRoute("/mkt-admin/ai-usage")({
  component: AiUsageDashboard,
});

const PROVIDER_COLORS: Record<string, string> = {
  muse: "hsl(174 62% 47%)",
  google: "hsl(217 91% 60%)",
  anthropic: "hsl(25 95% 53%)",
  mistral: "hsl(280 70% 60%)",
  unknown: "hsl(var(--muted-foreground))",
};
const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(217 91% 60%)",
  "hsl(174 62% 47%)",
  "hsl(280 70% 60%)",
  "hsl(25 95% 53%)",
  "hsl(340 75% 55%)",
  "hsl(45 93% 47%)",
  "hsl(150 60% 45%)",
];

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: n < 1 ? 4 : 2,
    maximumFractionDigits: 4,
  }).format(n || 0);
const fmtINR = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n || 0);
const fmtNum = (n: number) =>
  new Intl.NumberFormat("en-US", {
    notation: n >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(n || 0);

function AiUsageError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const kind = userFacingErrorKind(error);
  const copy = USER_FACING_ERRORS[kind];
  const warning = kind === "service" || kind === "network";
  const StatusIcon = kind === "access" ? ShieldAlert : AlertTriangle;
  return (
    <Card className={warning ? "border-amber-500/40 bg-amber-500/5" : "border-destructive/50"}>
      <CardContent role="alert" className="space-y-2 p-6 text-sm">
        <p className={`flex items-center gap-2 font-medium ${warning ? "text-amber-800 dark:text-amber-300" : "text-destructive"}`}>
          <StatusIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
          {copy.title}
        </p>
        <p>{copy.message} {copy.action}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>
      </CardContent>
    </Card>
  );
}

function AiUsageDashboard() {
  const [days, setDays] = useState(30);
  const fn = useServerFn(getPlatformAiUsage);
  const q = useQuery({
    queryKey: ["mkt", "ai-usage", days],
    queryFn: () => fn({ data: { days } }),
    refetchInterval: 60_000,
  });

  const d = q.data;

  const providerPie = useMemo(
    () =>
      (d?.byProvider ?? []).map((p, i) => ({
        name: p.provider,
        value: p.cost_usd,
        color: PROVIDER_COLORS[p.provider] ?? CHART_COLORS[i % CHART_COLORS.length],
      })),
    [d],
  );

  const exportCsv = () => {
    if (!d) return;
    const rows: string[] = ["scope,key,tokens_in,tokens_out,tokens,count,cost_usd,cost_inr"];
    for (const p of d.byProvider)
      rows.push(
        `provider,${p.provider},${p.tokens_in},${p.tokens_out},${p.tokens},${p.count},${p.cost_usd},${p.cost_inr}`,
      );
    for (const m of d.byModel)
      rows.push(
        `model,${m.model},${m.tokens_in},${m.tokens_out},${m.tokens},${m.count},${m.cost_usd},${m.cost_inr}`,
      );
    for (const t of d.byTenant)
      rows.push(
        `tenant,"${t.tenant_name}",${t.tokens_in},${t.tokens_out},${t.tokens},${t.count},${t.cost_usd},${t.cost_inr}`,
      );
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-usage-${days}d-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" /> Platform intelligence
          </div>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
            AI usage & cost analytics
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live cross-tenant view of AI spend, token consumption, model mix, and optimisation
            opportunities.
            {d?.usd_to_inr ? (
              <>
                {" "}
                Rates USD→INR <span className="font-medium">₹{d.usd_to_inr.toFixed(2)}</span>.
              </>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Last 24 hours</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            aria-label="Refresh AI usage"
            onClick={() => q.refetch()}
            disabled={q.isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="outline" onClick={exportCsv} disabled={!d}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
        </div>
      </div>

      {q.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="h-28 animate-pulse bg-muted/40" />
            </Card>
          ))}
        </div>
      ) : q.error ? (
        <AiUsageError error={q.error} onRetry={() => q.refetch()} />
      ) : d ? (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              icon={<DollarSign className="h-4 w-4" />}
              label={`Total spend (${d.window_days}d)`}
              usd={d.totals.cost_usd}
              inr={d.totals.cost_inr}
              accent="from-primary/20 via-primary/5 to-transparent"
              trend={d.trend_24h_pct}
              trendLabel="24h vs prior 24h"
            />
            <KpiCard
              icon={<Zap className="h-4 w-4" />}
              label="Today"
              usd={d.today.cost_usd}
              inr={d.today.cost_inr}
              accent="from-sky-500/20 via-sky-500/5 to-transparent"
              sub={`${fmtNum(d.today.tokens)} tokens · ${d.today.count} calls`}
            />
            <KpiCard
              icon={<Activity className="h-4 w-4" />}
              label="Month-to-date"
              usd={d.month.cost_usd}
              inr={d.month.cost_inr}
              accent="from-emerald-500/20 via-emerald-500/5 to-transparent"
              sub={`${fmtNum(d.month.tokens)} tokens · ${d.month.count} calls`}
            />
            <KpiCard
              icon={<Coins className="h-4 w-4" />}
              label="Blended $/1K tokens"
              usd={d.totals.cost_per_1k_tokens_usd}
              inr={d.totals.cost_per_1k_tokens_usd * d.usd_to_inr}
              accent="from-amber-500/20 via-amber-500/5 to-transparent"
              sub={`Avg ${fmtUSD(d.totals.avg_cost_per_call_usd)} per call`}
              precise
            />
          </div>

          {/* Insights */}
          {d.insights.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Lightbulb className="h-4 w-4 text-primary" /> AI insights & recommendations
                </CardTitle>
                <CardDescription>
                  Automated analysis of spend patterns, model mix, and cost-optimisation
                  opportunities.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {d.insights.map((i, k) => (
                  <div
                    key={k}
                    className={`rounded-xl border p-4 ${
                      i.severity === "critical"
                        ? "border-destructive/50 bg-destructive/5"
                        : i.severity === "warn"
                          ? "border-amber-500/50 bg-amber-500/5"
                          : i.severity === "success"
                            ? "border-emerald-500/50 bg-emerald-500/5"
                            : "border-border bg-muted/30"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="space-y-1">
                        <div className="text-sm font-semibold leading-snug">{i.title}</div>
                        <div className="text-xs text-muted-foreground">{i.detail}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Trend chart + Provider pie */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className="h-4 w-4" /> Daily spend trend
                </CardTitle>
                <CardDescription>
                  USD & INR cost per day for the last {d.window_days} days.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={d.daySeries} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gUsd" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      stroke="hsl(var(--muted-foreground))"
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      stroke="hsl(var(--muted-foreground))"
                      tickFormatter={(v) => `$${v}`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v: number, name: string) =>
                        name === "cost_usd"
                          ? [fmtUSD(v), "USD"]
                          : name === "cost_inr"
                            ? [fmtINR(v), "INR"]
                            : [fmtNum(v), name]
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="cost_usd"
                      stroke="hsl(var(--primary))"
                      fill="url(#gUsd)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bot className="h-4 w-4" /> Provider mix
                </CardTitle>
                <CardDescription>Spend distribution by AI provider.</CardDescription>
              </CardHeader>
              <CardContent>
                {providerPie.length === 0 ? (
                  <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
                    No data
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie
                        data={providerPie}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={55}
                        outerRadius={90}
                        paddingAngle={2}
                      >
                        {providerPie.map((p, i) => (
                          <Cell
                            key={i}
                            fill={p.color}
                            role="img"
                            aria-label={`${p.name}: ${fmtUSD(p.value)}`}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: number) => fmtUSD(v)}
                        contentStyle={{
                          background: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Detailed breakdown tabs */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Cost breakdown</CardTitle>
              <CardDescription>Drill into models, providers, tenants, and scopes.</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="models">
                <TabsList className="grid w-full grid-cols-4 md:w-auto md:inline-flex">
                  <TabsTrigger value="models">
                    <Cpu className="mr-1.5 h-3.5 w-3.5" /> Models
                  </TabsTrigger>
                  <TabsTrigger value="providers">
                    <Bot className="mr-1.5 h-3.5 w-3.5" /> Providers
                  </TabsTrigger>
                  <TabsTrigger value="tenants">
                    <Building2 className="mr-1.5 h-3.5 w-3.5" /> Tenants
                  </TabsTrigger>
                  <TabsTrigger value="scopes">
                    <Activity className="mr-1.5 h-3.5 w-3.5" /> Scopes
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="models" className="mt-4 space-y-4">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                      data={d.byModel.slice(0, 10)}
                      margin={{ top: 8, right: 8, left: -8, bottom: 40 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="model"
                        tick={{ fontSize: 10 }}
                        angle={-25}
                        textAnchor="end"
                        stroke="hsl(var(--muted-foreground))"
                      />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        stroke="hsl(var(--muted-foreground))"
                        tickFormatter={(v) => `$${v}`}
                      />
                      <Tooltip
                        formatter={(v: number) => fmtUSD(v)}
                        contentStyle={{
                          background: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="cost_usd" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Model</TableHead>
                          <TableHead>Provider</TableHead>
                          <TableHead className="text-right">Calls</TableHead>
                          <TableHead className="text-right">Tokens in</TableHead>
                          <TableHead className="text-right">Tokens out</TableHead>
                          <TableHead className="text-right">Cost USD</TableHead>
                          <TableHead className="text-right">Cost INR</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {d.byModel.length === 0 && (
                          <TableRow>
                            <TableCell
                              colSpan={7}
                              className="text-center text-sm text-muted-foreground"
                            >
                              No usage was recorded for this period.
                            </TableCell>
                          </TableRow>
                        )}
                        {d.byModel.map((m) => (
                          <TableRow key={m.model}>
                            <TableCell className="font-mono text-xs">{m.model}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="capitalize">
                                {m.provider}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {fmtNum(m.count)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {fmtNum(m.tokens_in)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {fmtNum(m.tokens_out)}
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {fmtUSD(m.cost_usd)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {fmtINR(m.cost_inr)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="providers" className="mt-4">
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Provider</TableHead>
                          <TableHead className="text-right">Calls</TableHead>
                          <TableHead className="text-right">Tokens</TableHead>
                          <TableHead className="text-right">Cost USD</TableHead>
                          <TableHead className="text-right">Cost INR</TableHead>
                          <TableHead className="text-right">% of spend</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {d.byProvider.length === 0 && (
                          <TableRow>
                            <TableCell
                              colSpan={6}
                              className="text-center text-sm text-muted-foreground"
                            >
                              No data.
                            </TableCell>
                          </TableRow>
                        )}
                        {d.byProvider.map((p) => (
                          <TableRow key={p.provider}>
                            <TableCell>
                              <Badge
                                className="capitalize"
                                style={{
                                  background: PROVIDER_COLORS[p.provider] ?? undefined,
                                  color: "white",
                                }}
                              >
                                {p.provider}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {fmtNum(p.count)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {fmtNum(p.tokens)}
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {fmtUSD(p.cost_usd)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {fmtINR(p.cost_inr)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {d.totals.cost_usd > 0
                                ? ((p.cost_usd / d.totals.cost_usd) * 100).toFixed(1)
                                : "0.0"}
                              %
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="tenants" className="mt-4">
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Tenant</TableHead>
                          <TableHead>Slug</TableHead>
                          <TableHead className="text-right">Calls</TableHead>
                          <TableHead className="text-right">Tokens</TableHead>
                          <TableHead className="text-right">Cost USD</TableHead>
                          <TableHead className="text-right">Cost INR</TableHead>
                          <TableHead className="text-right">% of spend</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {d.byTenant.length === 0 && (
                          <TableRow>
                            <TableCell
                              colSpan={7}
                              className="text-center text-sm text-muted-foreground"
                            >
                              No tenant usage was recorded for this period.
                            </TableCell>
                          </TableRow>
                        )}
                        {d.byTenant.map((t) => (
                          <TableRow key={t.tenant_id}>
                            <TableCell className="font-medium">{t.tenant_name}</TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {t.tenant_slug}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {fmtNum(t.count)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {fmtNum(t.tokens)}
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {fmtUSD(t.cost_usd)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {fmtINR(t.cost_inr)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {d.totals.cost_usd > 0
                                ? ((t.cost_usd / d.totals.cost_usd) * 100).toFixed(1)
                                : "0.0"}
                              %
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="scopes" className="mt-4">
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Scope</TableHead>
                          <TableHead className="text-right">Calls</TableHead>
                          <TableHead className="text-right">Tokens</TableHead>
                          <TableHead className="text-right">Cost USD</TableHead>
                          <TableHead className="text-right">Cost INR</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {d.byScope.length === 0 && (
                          <TableRow>
                            <TableCell
                              colSpan={5}
                              className="text-center text-sm text-muted-foreground"
                            >
                              No data.
                            </TableCell>
                          </TableRow>
                        )}
                        {d.byScope.map((s) => (
                          <TableRow key={s.scope}>
                            <TableCell>
                              <Badge variant="secondary" className="capitalize">
                                {s.scope}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {fmtNum(s.count)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {fmtNum(s.tokens)}
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {fmtUSD(s.cost_usd)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {fmtINR(s.cost_inr)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Pricing catalogue */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <BadgeIndianRupee className="h-4 w-4" /> Model pricing catalogue
              </CardTitle>
              <CardDescription>
                Per 1,000 tokens · USD and INR (rate ₹{d.usd_to_inr.toFixed(2)})
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead className="text-right">Input $/1K</TableHead>
                    <TableHead className="text-right">Output $/1K</TableHead>
                    <TableHead className="text-right">Input ₹/1K</TableHead>
                    <TableHead className="text-right">Output ₹/1K</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.pricing.map((p) => (
                    <TableRow key={p.model}>
                      <TableCell className="font-mono text-xs">{p.model}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {p.provider}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        ${p.input_per_1k_usd.toFixed(6)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        ${p.output_per_1k_usd.toFixed(6)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        ₹{p.input_per_1k_inr.toFixed(4)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        ₹{p.output_per_1k_inr.toFixed(4)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function KpiCard({
  icon,
  label,
  usd,
  inr,
  sub,
  accent,
  trend,
  trendLabel,
  precise,
}: {
  icon: React.ReactNode;
  label: string;
  usd: number;
  inr: number;
  sub?: string;
  accent: string;
  trend?: number;
  trendLabel?: string;
  precise?: boolean;
}) {
  const trendUp = (trend ?? 0) > 0;
  return (
    <Card className="relative overflow-hidden">
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${accent}`}
      />
      <CardContent className="relative p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-background/60 text-foreground">
              {icon}
            </span>
            {label}
          </div>
          {trend !== undefined && (
            <Badge
              variant="outline"
              className={`gap-1 ${trendUp ? "border-amber-500/40 text-amber-600 dark:text-amber-400" : "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"}`}
            >
              {trendUp ? (
                <ArrowUpRight className="h-3 w-3" />
              ) : (
                <ArrowDownRight className="h-3 w-3" />
              )}
              {Math.abs(trend).toFixed(1)}%
            </Badge>
          )}
        </div>
        <div className="mt-3 font-display text-2xl font-semibold tracking-tight">
          {precise ? `$${usd.toFixed(4)}` : fmtUSD(usd)}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          ≈ {precise ? `₹${inr.toFixed(4)}` : fmtINR(inr)}
        </div>
        {sub && <div className="mt-2 text-xs text-muted-foreground">{sub}</div>}
        {trendLabel && (
          <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">
            {trendLabel}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
