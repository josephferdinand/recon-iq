import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Activity, AlertTriangle, CheckCircle2, XCircle, Bot, Cpu, Coins,
  ShieldCheck, ShieldAlert, Sparkles, TrendingUp, Zap, Clock, DollarSign,
  Database, Layers, Network, Gauge,
} from "lucide-react";
import {
  getUsageAnalytics, getTokenAnalytics, getCostAnalytics,
  getAiStatusMatrix, getRiskCompliance, getAiOpsSnapshot,
  type Granularity,
} from "@/lib/ai-analytics.functions";
import { cn } from "@/lib/utils";

// ------- shared helpers -------
function formatNum(n: number) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}
function formatUsd(n: number | null | undefined) {
  return n == null ? "—" : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function RangeControls({
  value, onChange,
}: { value: { from: string; to: string; granularity: Granularity }; onChange: (v: any) => void }) {
  return (
    <div className="flex flex-wrap gap-3 items-end">
      <div><Label className="text-xs">From</Label><Input type="date" value={value.from.slice(0, 10)} onChange={(e) => onChange({ ...value, from: new Date(e.target.value).toISOString() })} className="w-40" /></div>
      <div><Label className="text-xs">To</Label><Input type="date" value={value.to.slice(0, 10)} onChange={(e) => onChange({ ...value, to: new Date(e.target.value).toISOString() })} className="w-40" /></div>
      <div>
        <Label className="text-xs">Granularity</Label>
        <Select value={value.granularity} onValueChange={(v) => onChange({ ...value, granularity: v as Granularity })}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(["hour", "day", "week", "month", "quarter", "year"] as Granularity[]).map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-1">
        {[
          { l: "7d", d: 7 }, { l: "30d", d: 30 }, { l: "90d", d: 90 }, { l: "1y", d: 365 },
        ].map((p) => (
          <button key={p.l} onClick={() => onChange({ ...value, from: new Date(Date.now() - p.d * 86400_000).toISOString(), to: new Date().toISOString() })}
            className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:bg-muted">
            {p.l}
          </button>
        ))}
      </div>
    </div>
  );
}

function BreakdownTable({ title, rows, valueLabel = "Value", formatter }: { title: string; rows: Array<{ label: string; value: number }>; valueLabel?: string; formatter?: (n: number) => string }) {
  const fmt = formatter ?? formatNum;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? <p className="text-xs text-muted-foreground">No data</p> : (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.label} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="truncate max-w-[70%]" title={r.label}>{r.label}</span>
                  <span className="tabular-nums font-medium">{fmt(r.value)}</span>
                </div>
                <Progress value={(r.value / max) * 100} className="h-1.5" />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Sparkline({ series, valueKey = "cost_usd", height = 60 }: { series: any[]; valueKey?: string; height?: number }) {
  if (!series.length) return <div className="text-xs text-muted-foreground">No data</div>;
  const values = series.map((s) => Number(s[valueKey] ?? 0));
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const w = 100;
  const h = height;
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${h - ((v - min) / range) * h}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <polyline points={pts} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone = "primary" }: any) {
  const toneMap: Record<string, string> = { primary: "text-primary", success: "text-emerald-500", info: "text-sky-500", warning: "text-amber-500", destructive: "text-destructive" };
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className="text-2xl font-semibold mt-1 tabular-nums">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <Icon className={cn("h-6 w-6", toneMap[tone])} />
        </div>
      </CardContent>
    </Card>
  );
}

// ================================================================
// STATUS MATRIX
// ================================================================
export function AiStatusMatrixTab({ tenantId }: { tenantId?: string | null }) {
  const fn = useServerFn(getAiStatusMatrix);
  const { data } = useQuery({ queryKey: ["ai-status-matrix", tenantId], queryFn: () => fn({ data: { tenant_id: tenantId ?? null } }) });
  const items: Array<{ key: string; label: string; on?: boolean; hint?: string }> = [
    { key: "ai_enabled", label: "AI Enabled", on: data?.ai_enabled },
    { key: "copilot_enabled", label: "Copilot", on: data?.copilot_enabled },
    { key: "autonomous_agents", label: "Autonomous Agents", on: data?.autonomous_agents },
    { key: "agentic_workflows", label: "Agentic Workflows", on: data?.agentic_workflows },
    { key: "byo_llm", label: "BYO LLM", on: data?.byo_llm },
    { key: "external_providers", label: "External Providers", on: data?.external_providers },
    { key: "prompt_logging", label: "Prompt Logging", on: data?.prompt_logging },
    { key: "pii_protection", label: "PII Protection", on: data?.pii_protection },
    { key: "auto_remediation", label: "Auto Remediation", on: data?.auto_remediation },
    { key: "ai_recommendations", label: "AI Recommendations", on: data?.ai_recommendations },
  ];
  const enabledCount = items.filter((i) => i.on).length;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Kpi icon={ShieldCheck} label="Governance Score" value={`${Math.round((enabledCount / items.length) * 100)}%`} sub={`${enabledCount}/${items.length} capabilities enabled`} tone="success" />
        <Kpi icon={Sparkles} label="Scope" value={tenantId ? "Tenant" : "Platform"} sub={tenantId ? "Inherits platform ceilings" : "Global defaults"} tone="info" />
        <Kpi icon={Gauge} label="Posture" value={data?.pii_protection && data?.prompt_logging ? "Enterprise" : "Standard"} sub="PII + prompt logging status" tone="primary" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((i) => (
          <Card key={i.key} className={cn(i.on ? "border-emerald-500/40" : "border-border")}>
            <CardContent className="pt-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{i.label}</p>
                <p className="text-xs text-muted-foreground">{i.on ? "Enabled" : "Disabled"}</p>
              </div>
              {i.on ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <XCircle className="h-5 w-5 text-muted-foreground" />}
            </CardContent>
          </Card>
        ))}
      </div>
      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>How to change these</AlertTitle>
        <AlertDescription>Every toggle above is enforced by the Governance tab. Tenant scope inherits platform ceilings — a capability disabled at platform cannot be enabled at tenant.</AlertDescription>
      </Alert>
    </div>
  );
}

// ================================================================
// USAGE ANALYTICS
// ================================================================
export function AiUsageAnalyticsTab({ tenantId }: { tenantId?: string | null }) {
  const [range, setRange] = useState({ from: new Date(Date.now() - 30 * 86400_000).toISOString(), to: new Date().toISOString(), granularity: "day" as Granularity });
  const fn = useServerFn(getUsageAnalytics);
  const { data, isLoading } = useQuery({
    queryKey: ["ai-usage-analytics", tenantId, range],
    queryFn: () => fn({ data: { ...range, tenant_id: tenantId ?? null, top_n: 10 } }),
  });
  return (
    <div className="space-y-6">
      <RangeControls value={range} onChange={setRange} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={Activity} label="Total Requests" value={formatNum(data?.totals.requests ?? 0)} tone="primary" />
        <Kpi icon={Bot} label="Agent Executions" value={formatNum(data?.totals.agent_executions ?? 0)} tone="info" />
        <Kpi icon={Sparkles} label="Copilot Interactions" value={formatNum(data?.totals.copilot_interactions ?? 0)} tone="success" />
        <Kpi icon={Coins} label="Cost" value={formatUsd(data?.totals.cost_usd ?? 0)} tone="warning" />
      </div>
      <Card>
        <CardHeader><CardTitle className="text-sm">Requests over time</CardTitle><CardDescription>{data?.range.granularity} buckets</CardDescription></CardHeader>
        <CardContent><Sparkline series={data?.series ?? []} valueKey="requests" height={120} /></CardContent>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <BreakdownTable title="By Provider" rows={data?.breakdowns.by_provider ?? []} />
        <BreakdownTable title="By Model" rows={data?.breakdowns.by_model ?? []} />
        <BreakdownTable title="By Scope" rows={data?.breakdowns.by_scope ?? []} />
        <BreakdownTable title="By Tenant" rows={data?.breakdowns.by_tenant ?? []} />
        <BreakdownTable title="By Workspace" rows={data?.breakdowns.by_workspace ?? []} />
        <BreakdownTable title="By User" rows={data?.breakdowns.by_user ?? []} />
      </div>
      {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
    </div>
  );
}

// ================================================================
// TOKEN ANALYTICS
// ================================================================
export function AiTokenAnalyticsTab({ tenantId }: { tenantId?: string | null }) {
  const [range, setRange] = useState({ from: new Date(Date.now() - 30 * 86400_000).toISOString(), to: new Date().toISOString(), granularity: "day" as Granularity });
  const fn = useServerFn(getTokenAnalytics);
  const { data } = useQuery({ queryKey: ["ai-token-analytics", tenantId, range], queryFn: () => fn({ data: { ...range, tenant_id: tenantId ?? null, top_n: 10 } }) });
  return (
    <div className="space-y-6">
      <RangeControls value={range} onChange={setRange} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={TrendingUp} label="Input" value={formatNum(data?.totals.input ?? 0)} tone="primary" />
        <Kpi icon={TrendingUp} label="Output" value={formatNum(data?.totals.output ?? 0)} tone="success" />
        <Kpi icon={Database} label="Cached" value={formatNum(data?.totals.cached ?? 0)} tone="info" />
        <Kpi icon={Layers} label="Embedding" value={formatNum(data?.totals.embedding ?? 0)} tone="info" />
        <Kpi icon={Bot} label="Agent" value={formatNum(data?.totals.agent ?? 0)} tone="warning" />
        <Kpi icon={Network} label="RAG" value={formatNum(data?.totals.rag ?? 0)} tone="info" />
        <Kpi icon={Zap} label="Tool" value={formatNum(data?.totals.tool ?? 0)} tone="warning" />
        <Kpi icon={Sparkles} label="Total" value={formatNum(data?.totals.total ?? 0)} tone="primary" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card><CardHeader><CardTitle className="text-sm">Token trend</CardTitle></CardHeader><CardContent><Sparkline series={data?.series ?? []} valueKey="total" height={140} /></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">7-{range.granularity} forecast (avg baseline)</CardTitle></CardHeader><CardContent><Sparkline series={data?.forecast ?? []} valueKey="projected" height={140} /></CardContent></Card>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <BreakdownTable title="Tokens by Model" rows={data?.breakdowns.by_model ?? []} />
        <BreakdownTable title="Tokens by Provider" rows={data?.breakdowns.by_provider ?? []} />
        <BreakdownTable title="Tokens by Tenant" rows={data?.breakdowns.by_tenant ?? []} />
        <BreakdownTable title="Tokens by Workspace" rows={data?.breakdowns.by_workspace ?? []} />
        <BreakdownTable title="Tokens by User" rows={data?.breakdowns.by_user ?? []} />
      </div>
    </div>
  );
}

// ================================================================
// COST CENTER
// ================================================================
export function AiCostCenterTab({ tenantId }: { tenantId?: string | null }) {
  const [range, setRange] = useState({ from: new Date(Date.now() - 30 * 86400_000).toISOString(), to: new Date().toISOString(), granularity: "day" as Granularity });
  const fn = useServerFn(getCostAnalytics);
  const { data } = useQuery({ queryKey: ["ai-cost-center", tenantId, range], queryFn: () => fn({ data: { ...range, tenant_id: tenantId ?? null, top_n: 10 } }) });
  const util = data?.totals.budget_utilization_pct ?? null;
  return (
    <div className="space-y-6">
      <RangeControls value={range} onChange={setRange} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={DollarSign} label="Total Spend" value={formatUsd(data?.totals.cost_usd ?? 0)} tone="primary" />
        <Kpi icon={ShieldCheck} label="Budget" value={formatUsd(data?.totals.budget_usd ?? 0)} tone="info" />
        <Kpi icon={Gauge} label="Utilization" value={util == null ? "—" : `${util}%`} sub={util && util > 90 ? "Over 90%" : "Healthy"} tone={util && util > 90 ? "destructive" : "success"} />
        <Kpi icon={AlertTriangle} label="Anomalies" value={data?.anomalies.length ?? 0} sub="buckets > mean+2σ" tone="warning" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card><CardHeader><CardTitle className="text-sm">Spend trend</CardTitle></CardHeader><CardContent><Sparkline series={data?.series ?? []} valueKey="cost_usd" height={140} /></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Forecast (linear)</CardTitle></CardHeader><CardContent><Sparkline series={data?.forecast ?? []} valueKey="projected" height={140} /></CardContent></Card>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <BreakdownTable title="Spend by Provider" rows={data?.breakdowns.by_provider ?? []} formatter={formatUsd} />
        <BreakdownTable title="Spend by Model" rows={data?.breakdowns.by_model ?? []} formatter={formatUsd} />
        <BreakdownTable title="Spend by Tenant" rows={data?.breakdowns.by_tenant ?? []} formatter={formatUsd} />
        <BreakdownTable title="Spend by Workspace" rows={data?.breakdowns.by_workspace ?? []} formatter={formatUsd} />
        <BreakdownTable title="Spend by User" rows={data?.breakdowns.by_user ?? []} formatter={formatUsd} />
        <BreakdownTable title="Spend by Department" rows={data?.breakdowns.by_department ?? []} formatter={formatUsd} />
        <BreakdownTable title="Spend by Agent" rows={data?.breakdowns.by_agent ?? []} formatter={formatUsd} />
      </div>
      <Card>
        <CardHeader><CardTitle className="text-sm">Provider Cost Intelligence — per 1K tokens</CardTitle><CardDescription>Sourced from ai_model_pricing (no hardcoded rates)</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Model</TableHead><TableHead className="text-right">Input / 1K</TableHead><TableHead className="text-right">Output / 1K</TableHead></TableRow></TableHeader>
            <TableBody>
              {(data?.pricing_card ?? []).map((p) => (
                <TableRow key={p.model}><TableCell><code className="text-xs">{p.model}</code></TableCell><TableCell className="text-right">{formatUsd(p.input_per_1k)}</TableCell><TableCell className="text-right">{formatUsd(p.output_per_1k)}</TableCell></TableRow>
              ))}
              {(!data?.pricing_card || data.pricing_card.length === 0) && (
                <TableRow><TableCell colSpan={3} className="text-center text-xs text-muted-foreground">No pricing configured. Add entries in ai_model_pricing.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {data?.anomalies && data.anomalies.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Cost anomalies detected</AlertTitle>
          <AlertDescription>{data.anomalies.map((a) => `${a.bucket}: ${formatUsd(a.cost_usd)}`).join(" · ")}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

// ================================================================
// RISK & COMPLIANCE
// ================================================================
export function AiRiskComplianceTab({ tenantId }: { tenantId?: string | null }) {
  const fn = useServerFn(getRiskCompliance);
  const { data } = useQuery({ queryKey: ["ai-risk", tenantId], queryFn: () => fn({ data: { tenant_id: tenantId ?? null, days: 30 } }) });
  const risk = data?.risk_score ?? 0;
  const tone = risk > 70 ? "destructive" : risk > 40 ? "warning" : "success";
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi icon={ShieldAlert} label="Risk Score" value={`${risk}/100`} tone={tone as any} />
        <Kpi icon={XCircle} label="Blocked Prompts" value={data?.totals.blocked_prompts ?? 0} tone="destructive" />
        <Kpi icon={AlertTriangle} label="HITL Pending" value={data?.totals.hitl_pending ?? 0} tone="warning" />
        <Kpi icon={Activity} label="Drift Alerts" value={data?.totals.drift_alerts_open ?? 0} tone="warning" />
        <Kpi icon={Zap} label="Kill Switches" value={data?.totals.kill_switches_engaged ?? 0} tone="destructive" />
      </div>
      <Card>
        <CardHeader><CardTitle className="text-sm">Blocked prompts trend (30d)</CardTitle></CardHeader>
        <CardContent><Sparkline series={data?.blocked_series ?? []} valueKey="count" height={100} /></CardContent>
      </Card>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Recent drift alerts</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Severity</TableHead><TableHead>Metric</TableHead><TableHead className="text-right">Δ%</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {(data?.recent_drift ?? []).map((d: any) => (
                  <TableRow key={d.id}><TableCell><Badge variant={d.severity === "high" ? "destructive" : "outline"}>{d.severity}</Badge></TableCell><TableCell className="text-xs">{d.metric ?? "—"}</TableCell><TableCell className="text-right tabular-nums">{Number(d.delta_pct ?? 0).toFixed(1)}%</TableCell><TableCell><Badge variant="outline">{d.status}</Badge></TableCell></TableRow>
                ))}
                {(data?.recent_drift ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-xs text-muted-foreground">No alerts</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Kill switches</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Scope</TableHead><TableHead>State</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
              <TableBody>
                {(data?.kill_switches ?? []).map((k: any) => (
                  <TableRow key={k.id}><TableCell className="text-xs">{k.scope}</TableCell><TableCell>{k.engaged ? <Badge variant="destructive">engaged</Badge> : <Badge variant="outline">released</Badge>}</TableCell><TableCell className="text-xs truncate max-w-[200px]">{k.reason ?? "—"}</TableCell></TableRow>
                ))}
                {(data?.kill_switches ?? []).length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-xs text-muted-foreground">None</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ================================================================
// OPERATIONS DASHBOARD
// ================================================================
export function AiOperationsTab({ tenantId }: { tenantId?: string | null }) {
  const [minutes, setMinutes] = useState(60);
  const fn = useServerFn(getAiOpsSnapshot);
  const { data, refetch, isFetching } = useQuery({
    queryKey: ["ai-ops", tenantId, minutes],
    queryFn: () => fn({ data: { tenant_id: tenantId ?? null, minutes } }),
    refetchInterval: 30_000,
  });
  return (
    <div className="space-y-6">
      <div className="flex gap-3 items-end">
        <div>
          <Label className="text-xs">Window</Label>
          <Select value={String(minutes)} onValueChange={(v) => setMinutes(Number(v))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="15">15 min</SelectItem>
              <SelectItem value="60">1 hour</SelectItem>
              <SelectItem value="360">6 hours</SelectItem>
              <SelectItem value="1440">24 hours</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <button onClick={() => refetch()} className="text-xs px-2 py-1 rounded border border-border hover:bg-muted">{isFetching ? "…" : "Refresh"}</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi icon={Cpu} label="Total Instances" value={data?.health.total ?? 0} tone="primary" />
        <Kpi icon={CheckCircle2} label="Healthy" value={data?.health.healthy ?? 0} tone="success" />
        <Kpi icon={AlertTriangle} label="Degraded" value={data?.health.degraded ?? 0} tone="warning" />
        <Kpi icon={XCircle} label="Down" value={data?.health.down ?? 0} tone="destructive" />
        <Kpi icon={Clock} label="Unknown" value={data?.health.unknown ?? 0} tone="info" />
      </div>
      <Card>
        <CardHeader><CardTitle className="text-sm">Provider performance ({minutes} min)</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Provider</TableHead><TableHead className="text-right">Requests</TableHead><TableHead className="text-right">RPM</TableHead><TableHead className="text-right">Avg latency</TableHead><TableHead className="text-right">Error rate</TableHead></TableRow></TableHeader>
            <TableBody>
              {(data?.provider_metrics ?? []).map((p) => (
                <TableRow key={p.provider}>
                  <TableCell className="text-sm font-medium">{p.provider}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNum(p.requests)}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.rpm}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.avg_latency_ms} ms</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Badge variant={p.error_rate_pct > 5 ? "destructive" : p.error_rate_pct > 1 ? "outline" : "secondary"}>{p.error_rate_pct}%</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(data?.provider_metrics ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-xs text-muted-foreground">No activity in window</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Provider instances</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Provider</TableHead><TableHead>Status</TableHead><TableHead>Health</TableHead><TableHead>Last check</TableHead></TableRow></TableHeader>
            <TableBody>
              {(data?.instances ?? []).map((i: any) => (
                <TableRow key={i.id}>
                  <TableCell className="text-sm">{i.display_name}</TableCell>
                  <TableCell className="text-xs"><code>{i.provider_code}</code></TableCell>
                  <TableCell><Badge variant={i.status === "active" ? "default" : "outline"}>{i.status}</Badge></TableCell>
                  <TableCell><Badge variant={i.health_status === "healthy" ? "secondary" : i.health_status === "down" ? "destructive" : "outline"}>{i.health_status}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{i.last_healthcheck_at ? new Date(i.last_healthcheck_at).toLocaleString() : "never"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
