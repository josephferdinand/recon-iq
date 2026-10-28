import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { listMyAuthEvents } from "@/lib/security.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, RefreshCw, Filter, FileText } from "lucide-react";
import { exportPdf, exportXlsxCols, type ExportColumn } from "@/lib/export-utils";

type EventRow = {
  id: number;
  occurred_at: string;
  event_type: string;
  severity: string;
  ip: string | null;
  context: any;
};

const ALL_EVENT_TYPES: { value: string; label: string }[] = [
  { value: "auth.success_login", label: "Login success" },
  { value: "auth.failed_login", label: "Login failed" },
  { value: "auth.logout", label: "Logout" },
  { value: "auth.signup_success", label: "Signup success" },
  { value: "auth.signup_failed", label: "Signup failed" },
  { value: "auth.password_reset_requested", label: "Password reset requested" },
  { value: "auth.password_reset_completed", label: "Password reset completed" },
  { value: "auth.password_reset_failed", label: "Password reset failed" },
  { value: "auth.mfa_failed", label: "MFA failed" },
  { value: "auth.mfa_enroll_failed", label: "MFA enrol failed" },
];

const RANGE_OPTIONS = [
  { value: "24h", label: "Last 24 hours", hours: 24 },
  { value: "7d", label: "Last 7 days", hours: 24 * 7 },
  { value: "30d", label: "Last 30 days", hours: 24 * 30 },
  { value: "90d", label: "Last 90 days", hours: 24 * 90 },
  { value: "all", label: "All time", hours: 0 },
];

function severityVariant(sev: string): "default" | "secondary" | "destructive" | "outline" {
  if (sev === "critical") return "destructive";
  if (sev === "warning") return "destructive";
  if (sev === "info") return "secondary";
  return "outline";
}

function eventLabel(type: string): string {
  return ALL_EVENT_TYPES.find((t) => t.value === type)?.label ?? type;
}

function toCsv(rows: EventRow[]): string {
  const header = ["occurred_at", "event_type", "severity", "ip", "context"];
  const lines = [header.join(",")];
  for (const r of rows) {
    const ctx = JSON.stringify(r.context ?? {}).replace(/"/g, '""');
    lines.push([r.occurred_at, r.event_type, r.severity, r.ip ?? "", `"${ctx}"`].join(","));
  }
  return lines.join("\n");
}

function summariseContext(ctx: any): string {
  if (!ctx || typeof ctx !== "object") return "—";
  const parts: string[] = [];
  if (ctx.email) parts.push(`email=${ctx.email}`);
  if (ctx.reason) parts.push(`reason=${ctx.reason}`);
  if (ctx.user_agent) parts.push(`ua=${String(ctx.user_agent).slice(0, 60)}`);
  if (ctx.tenant_slug) parts.push(`tenant=${ctx.tenant_slug}`);
  return parts.length ? parts.join(" · ") : JSON.stringify(ctx);
}

export function SecurityAuditTab() {
  const fetchEvents = useServerFn(listMyAuthEvents);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedSeverities, setSelectedSeverities] = useState<string[]>([]);
  const [range, setRange] = useState<string>("7d");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");

  const since = useMemo(() => {
    const r = RANGE_OPTIONS.find((o) => o.value === range);
    if (!r || r.hours === 0) return undefined;
    return new Date(Date.now() - r.hours * 3600 * 1000).toISOString();
  }, [range]);

  const queryArgs = {
    event_types: selectedTypes.length ? selectedTypes : undefined,
    severities: selectedSeverities.length ? (selectedSeverities as ("info" | "warning" | "critical")[]) : undefined,
    since,
    search: appliedSearch || undefined,
    limit: 500,
  };

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["platform-security-audit", queryArgs],
    queryFn: () => fetchEvents({ data: queryArgs }),
  });

  const events: EventRow[] = (data?.events as EventRow[]) ?? [];

  const counts = useMemo(() => {
    const c = { total: events.length, success: 0, failed: 0, resets: 0 };
    for (const e of events) {
      if (e.event_type.includes("success") || e.event_type === "auth.logout") c.success += 1;
      else if (e.event_type.includes("failed")) c.failed += 1;
      if (e.event_type.includes("password_reset")) c.resets += 1;
    }
    return c;
  }, [events]);

  function toggle(list: string[], setList: (l: string[]) => void, v: string) {
    setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  }

  function downloadCsv() {
    const blob = new Blob([toCsv(events)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `security-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function resetFilters() {
    setSelectedTypes([]);
    setSelectedSeverities([]);
    setRange("7d");
    setSearch("");
    setAppliedSearch("");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">Security Audit</h1>
          <p className="text-sm text-muted-foreground">
            Authentication activity — sign-ins, sign-outs, password resets, and MFA events.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-1 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={downloadCsv} disabled={!events.length}>
            <Download className="mr-1 h-4 w-4" /> Export CSV
          </Button>
          <Button
            variant="outline" size="sm" disabled={!events.length}
            onClick={() => {
              const cols: ExportColumn<EventRow>[] = [
                { key: "occurred_at", header: "When", value: (r) => new Date(r.occurred_at).toISOString() },
                { key: "event_type", header: "Event", value: (r) => eventLabel(r.event_type) },
                { key: "severity", header: "Severity" },
                { key: "ip", header: "IP", value: (r) => r.ip ?? "" },
                { key: "context", header: "Details", value: (r) => summariseContext(r.context) },
              ];
              exportXlsxCols(`security-audit-${new Date().toISOString().slice(0,10)}.xlsx`, "Security", cols, events);
            }}
          >
            <Download className="mr-1 h-4 w-4" /> Export XLSX
          </Button>
          <Button
            variant="outline" size="sm" disabled={!events.length}
            onClick={() => {
              const cols: ExportColumn<EventRow>[] = [
                { key: "occurred_at", header: "When", value: (r) => new Date(r.occurred_at).toISOString() },
                { key: "event_type", header: "Event", value: (r) => eventLabel(r.event_type) },
                { key: "severity", header: "Severity" },
                { key: "ip", header: "IP", value: (r) => r.ip ?? "" },
                { key: "context", header: "Details", value: (r) => summariseContext(r.context) },
              ];
              const subtitle = `Range: ${range} · ${events.length} events · Types: ${selectedTypes.length ? selectedTypes.join(", ") : "all"} · Severities: ${selectedSeverities.length ? selectedSeverities.join(", ") : "all"}`;
              exportPdf(`security-audit-${new Date().toISOString().slice(0,10)}.pdf`, "Security audit — auth events", subtitle, cols, events);
            }}
          >
            <FileText className="mr-1 h-4 w-4" /> Export PDF
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardDescription>Events in view</CardDescription></CardHeader>
          <CardContent><div className="font-display text-2xl font-semibold">{counts.total}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Successful / logout</CardDescription></CardHeader>
          <CardContent><div className="font-display text-2xl font-semibold text-success">{counts.success}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Failed attempts</CardDescription></CardHeader>
          <CardContent><div className="font-display text-2xl font-semibold text-destructive">{counts.failed}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Password resets</CardDescription></CardHeader>
          <CardContent><div className="font-display text-2xl font-semibold">{counts.resets}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Filter className="h-4 w-4" /> Filters</CardTitle>
          <CardDescription>Narrow the audit log by event type, severity, time range, or IP address.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Time range</Label>
              <Select value={range} onValueChange={setRange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RANGE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>IP address contains</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. 192.168 or 2a01"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") setAppliedSearch(search.trim()); }}
                />
                <Button variant="secondary" onClick={() => setAppliedSearch(search.trim())}>Apply</Button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Event types</Label>
              <div className="grid grid-cols-2 gap-2">
                {ALL_EVENT_TYPES.map((t) => (
                  <label key={t.value} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedTypes.includes(t.value)}
                      onCheckedChange={() => toggle(selectedTypes, setSelectedTypes, t.value)}
                    />
                    {t.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Severity</Label>
              <div className="flex flex-col gap-2">
                {["info", "warning", "critical"].map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm capitalize">
                    <Checkbox
                      checked={selectedSeverities.includes(s)}
                      onCheckedChange={() => toggle(selectedSeverities, setSelectedSeverities, s)}
                    />
                    {s}
                  </label>
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={resetFilters} className="mt-2">Reset filters</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
          <CardDescription>Most recent first. Up to 500 events per view.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events match the current filters.</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">When</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead className="w-[120px]">Severity</TableHead>
                    <TableHead className="w-[160px]">IP</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-mono text-xs">{new Date(e.occurred_at).toLocaleString()}</TableCell>
                      <TableCell className="font-medium">{eventLabel(e.event_type)}</TableCell>
                      <TableCell>
                        <Badge variant={severityVariant(e.severity)} className="capitalize">{e.severity}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{e.ip ?? "—"}</TableCell>
                      <TableCell className="max-w-[420px] truncate text-xs text-muted-foreground" title={JSON.stringify(e.context ?? {})}>
                        {summariseContext(e.context)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
