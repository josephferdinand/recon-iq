import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { BackButton } from "@/components/back-button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Activity, AlertTriangle, BellRing, Gauge, PlayCircle, Plus, RefreshCcw, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import {
  getPipelineMetrics, listAlertConfigs, upsertAlertConfig, deleteAlertConfig,
  listAlertIncidents, resolveAlertIncident, evaluatePipelineAlerts,
  type PipelineBucket, type PipelineSummary,
} from "@/lib/observability-pipeline.functions";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

export const Route = createFileRoute("/_authenticated/platform-pipeline-status")({
  head: () => ({ meta: [
    { title: "APM & SIEM pipeline status — ReconIQ Platform" },
    { name: "description", content: "Live dashboards, alert rules, and incident history for the APM + SIEM ingestion pipeline (latency, drop rate, event volume)." },
  ] }),
  component: PipelineStatusPage,
});

const WINDOWS = [
  { label: "Last 15 min", value: 15 },
  { label: "Last 60 min", value: 60 },
  { label: "Last 6 hours", value: 360 },
  { label: "Last 24 hours", value: 1440 },
];

function formatTs(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function buildChartData(buckets: PipelineBucket[], sink: "apm" | "siem") {
  return buckets
    .filter((b) => b.sink === sink)
    .map((b) => ({
      t: formatTs(b.bucket_ts),
      ok: Number(b.ok_count),
      drops: Number(b.drop_count),
      errors: Number(b.error_count),
      volume: Number(b.ok_count) + Number(b.drop_count) + Number(b.error_count),
      avg_ms: Math.round(Number(b.latency_avg_ms)),
      max_ms: Number(b.latency_max_ms),
    }));
}

function SummaryTile({ s }: { s: PipelineSummary }) {
  const drop = s.drop_rate_pct;
  const err = s.error_rate_pct;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base uppercase tracking-wide">
          <Activity className="h-4 w-4 text-primary" aria-hidden />
          {s.sink}
        </CardTitle>
        <CardDescription>{s.total.toLocaleString()} events in window</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 text-sm">
        <Metric label="Drop rate" value={`${drop.toFixed(1)}%`} tone={drop > 5 ? "bad" : drop > 1 ? "warn" : "good"} icon={drop > 1 ? TrendingUp : TrendingDown} />
        <Metric label="Error rate" value={`${err.toFixed(1)}%`} tone={err > 2 ? "bad" : err > 0.5 ? "warn" : "good"} icon={err > 0.5 ? TrendingUp : TrendingDown} />
        <Metric label="Events / min" value={s.events_per_min.toFixed(1)} tone="neutral" icon={Gauge} />
        <Metric label="Latency avg / max" value={`${Math.round(s.latency_avg_ms)} / ${s.latency_max_ms} ms`} tone={s.latency_max_ms > 2000 ? "warn" : "good"} icon={Gauge} />
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, tone, icon: Icon }: { label: string; value: string; tone: "good" | "warn" | "bad" | "neutral"; icon: any }) {
  const toneCls = tone === "good" ? "text-emerald-800 dark:text-emerald-300" : tone === "warn" ? "text-amber-800 dark:text-amber-200" : tone === "bad" ? "text-destructive" : "text-muted-foreground";
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-2">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`flex items-center gap-1.5 text-base font-semibold ${toneCls}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden />{value}
      </div>
    </div>
  );
}

type AlertRow = {
  id: string; name: string; sink: "apm" | "siem" | "any";
  metric: "drop_rate_pct" | "p95_latency_ms" | "event_volume_min" | "error_rate_pct";
  threshold: number; window_minutes: number; enabled: boolean; last_fired_at: string | null;
};
type IncidentRow = {
  id: string; config_id: string; fired_at: string; observed_value: number;
  message: string; resolved_at: string | null;
  observability_alert_config?: { name: string; metric: string; sink: string; threshold: number } | null;
};

function PipelineStatusPage() {
  const qc = useQueryClient();
  const [windowMinutes, setWindowMinutes] = useState<number>(60);
  const metricsFn = useServerFn(getPipelineMetrics);
  const alertsFn = useServerFn(listAlertConfigs);
  const upsertFn = useServerFn(upsertAlertConfig);
  const deleteFn = useServerFn(deleteAlertConfig);
  const incidentsFn = useServerFn(listAlertIncidents);
  const resolveFn = useServerFn(resolveAlertIncident);
  const evalFn = useServerFn(evaluatePipelineAlerts);

  const metrics = useQuery({
    queryKey: ["pipeline-metrics", windowMinutes],
    queryFn: () => metricsFn({ data: { window_minutes: windowMinutes } }),
    refetchInterval: 30_000,
  });
  const alerts = useQuery({ queryKey: ["pipeline-alerts"], queryFn: () => alertsFn() });
  const incidents = useQuery({ queryKey: ["pipeline-incidents"], queryFn: () => incidentsFn(), refetchInterval: 60_000 });

  const upsert = useMutation({
    mutationFn: (data: any) => upsertFn({ data }),
    onSuccess: () => { toast.success("Alert saved"); qc.invalidateQueries({ queryKey: ["pipeline-alerts"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { toast.success("Alert removed"); qc.invalidateQueries({ queryKey: ["pipeline-alerts"] }); },
  });
  const evalAlerts = useMutation({
    mutationFn: () => evalFn(),
    onSuccess: (r: any) => {
      toast.success(`Evaluated ${r.evaluated} rule(s), ${r.fired} incident(s) fired`);
      qc.invalidateQueries({ queryKey: ["pipeline-incidents"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Evaluation failed"),
  });
  const resolve = useMutation({
    mutationFn: (id: string) => resolveFn({ data: { id } }),
    onSuccess: () => { toast.success("Incident resolved"); qc.invalidateQueries({ queryKey: ["pipeline-incidents"] }); },
  });

  const apmData = metrics.data ? buildChartData(metrics.data.buckets as PipelineBucket[], "apm") : [];
  const siemData = metrics.data ? buildChartData(metrics.data.buckets as PipelineBucket[], "siem") : [];

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <BackButton />
      <header className="mt-6 mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">Platform observability</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Gauge className="h-7 w-7 text-primary" aria-hidden />
            APM &amp; SIEM pipeline status
          </h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Live dashboards for the outbound APM + SIEM pipeline. Track latency, drop rate,
            error rate, and event volume; configure alert thresholds; review incidents.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(windowMinutes)} onValueChange={(v) => setWindowMinutes(Number(v))}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {WINDOWS.map((w) => <SelectItem key={w.value} value={String(w.value)}>{w.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => metrics.refetch()} aria-label="Refresh">
            <RefreshCcw className="h-4 w-4" aria-hidden />
          </Button>
          <Button className="gap-2" onClick={() => evalAlerts.mutate()} disabled={evalAlerts.isPending}>
            <PlayCircle className="h-4 w-4" aria-hidden />
            {evalAlerts.isPending ? "Evaluating…" : "Evaluate alerts"}
          </Button>
        </div>
      </header>

      {metrics.data && (
        <section className="grid gap-4 md:grid-cols-2">
          <SummaryTile s={metrics.data.apm as PipelineSummary} />
          <SummaryTile s={metrics.data.siem as PipelineSummary} />
        </section>
      )}

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <ChartCard title="APM event volume" data={apmData} kind="volume" empty="No APM samples in window." />
        <ChartCard title="SIEM event volume" data={siemData} kind="volume" empty="No SIEM samples in window." />
        <ChartCard title="APM latency (avg / max ms)" data={apmData} kind="latency" empty="No APM samples in window." />
        <ChartCard title="SIEM latency (avg / max ms)" data={siemData} kind="latency" empty="No SIEM samples in window." />
        <ChartCard title="APM drops & errors" data={apmData} kind="failures" empty="No APM samples in window." />
        <ChartCard title="SIEM drops & errors" data={siemData} kind="failures" empty="No SIEM samples in window." />
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold flex items-center gap-2"><BellRing className="h-5 w-5 text-primary" aria-hidden />Alert rules</h2>
          <NewAlertButton onSave={(d) => upsert.mutate(d)} pending={upsert.isPending} />
        </div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead><TableHead>Sink</TableHead><TableHead>Metric</TableHead>
                  <TableHead>Threshold</TableHead><TableHead>Window</TableHead>
                  <TableHead>Enabled</TableHead><TableHead>Last fired</TableHead><TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(alerts.data as AlertRow[] | undefined)?.length ? (alerts.data as AlertRow[]).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell><Badge variant="outline">{a.sink}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{a.metric}</TableCell>
                    <TableCell>{a.threshold}</TableCell>
                    <TableCell>{a.window_minutes} min</TableCell>
                    <TableCell>
                      <Switch checked={a.enabled} onCheckedChange={(v) => upsert.mutate({ ...a, enabled: v })} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {a.last_fired_at ? new Date(a.last_fired_at).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => del.mutate(a.id)} aria-label="Delete">
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                    No alert rules yet. Add one to start monitoring.
                  </TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-xl font-semibold flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-primary" aria-hidden />Recent incidents
        </h2>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fired</TableHead><TableHead>Rule</TableHead>
                  <TableHead>Value</TableHead><TableHead>Message</TableHead>
                  <TableHead>Status</TableHead><TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(incidents.data as IncidentRow[] | undefined)?.length ? (incidents.data as IncidentRow[]).map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="text-xs">{new Date(i.fired_at).toLocaleString()}</TableCell>
                    <TableCell>{i.observability_alert_config?.name ?? i.config_id.slice(0, 8)}</TableCell>
                    <TableCell className="font-mono">{Number(i.observed_value).toFixed(2)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{i.message}</TableCell>
                    <TableCell>
                      {i.resolved_at
                        ? <Badge variant="secondary">Resolved</Badge>
                        : <Badge variant="destructive">Open</Badge>}
                    </TableCell>
                    <TableCell>
                      {!i.resolved_at && (
                        <Button variant="outline" size="sm" onClick={() => resolve.mutate(i.id)}>Resolve</Button>
                      )}
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                    No incidents recorded.
                  </TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function ChartCard({ title, data, kind, empty }: {
  title: string;
  data: Array<{ t: string; ok: number; drops: number; errors: number; volume: number; avg_ms: number; max_ms: number }>;
  kind: "volume" | "latency" | "failures";
  empty: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="h-56">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{empty}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {kind === "volume" ? (
              <AreaChart data={data}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="t" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", color: "hsl(var(--popover-foreground))" }} />
                <Area type="monotone" dataKey="volume" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} />
              </AreaChart>
            ) : kind === "latency" ? (
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="t" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", color: "hsl(var(--popover-foreground))" }} />
                <Line type="monotone" dataKey="avg_ms" stroke="hsl(var(--primary))" dot={false} />
                <Line type="monotone" dataKey="max_ms" stroke="hsl(var(--destructive))" dot={false} />
              </LineChart>
            ) : (
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="t" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", color: "hsl(var(--popover-foreground))" }} />
                <Bar dataKey="drops" fill="hsl(var(--muted-foreground))" />
                <Bar dataKey="errors" fill="hsl(var(--destructive))" />
              </BarChart>
            )}
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function NewAlertButton({ onSave, pending }: { onSave: (d: any) => void; pending: boolean }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "", sink: "any", metric: "drop_rate_pct",
    threshold: 5, window_minutes: 5, enabled: true,
  });
  if (!open) {
    return <Button className="gap-2" onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden />New alert rule</Button>;
  }
  return (
    <Card className="w-full sm:w-[560px]">
      <CardHeader className="pb-2"><CardTitle className="text-base">New alert rule</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="APM drop rate > 5%" />
        </div>
        <div>
          <Label>Sink</Label>
          <Select value={form.sink} onValueChange={(v) => setForm({ ...form, sink: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              <SelectItem value="apm">APM</SelectItem>
              <SelectItem value="siem">SIEM</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Metric</Label>
          <Select value={form.metric} onValueChange={(v) => setForm({ ...form, metric: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="drop_rate_pct">Drop rate %</SelectItem>
              <SelectItem value="error_rate_pct">Error rate %</SelectItem>
              <SelectItem value="p95_latency_ms">Max latency (ms)</SelectItem>
              <SelectItem value="event_volume_min">Min events / min</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Threshold</Label>
          <Input type="number" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })} />
        </div>
        <div>
          <Label>Window (min)</Label>
          <Input type="number" value={form.window_minutes} onChange={(e) => setForm({ ...form, window_minutes: Number(e.target.value) })} min={1} max={1440} />
        </div>
        <div className="col-span-2 flex items-center justify-between pt-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
            Enabled
          </label>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={pending || !form.name.trim()} onClick={() => {
              onSave(form);
              setOpen(false);
              setForm({ name: "", sink: "any", metric: "drop_rate_pct", threshold: 5, window_minutes: 5, enabled: true });
            }}>Save</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
