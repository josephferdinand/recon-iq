import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listRecentAudit } from "@/lib/tenants.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

type Row = {
  id: number | string;
  occurred_at: string;
  actor_email: string | null;
  scope: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  context: any;
};

const DAYS = 119; // ~17 weeks

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function bucketColor(count: number, max: number) {
  if (count === 0) return "bg-muted/40";
  const ratio = count / Math.max(max, 1);
  if (ratio > 0.75) return "bg-primary";
  if (ratio > 0.5) return "bg-primary/75";
  if (ratio > 0.25) return "bg-primary/55";
  return "bg-primary/30";
}

function toCsv(rows: Row[]) {
  const head = ["time", "actor", "scope", "action", "resource_type", "resource_id", "via_platform_admin"];
  const lines = [head.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.occurred_at,
        r.actor_email ?? "Actor not recorded",
        r.scope ?? "",
        r.action,
        r.resource_type ?? "",
        r.resource_id ?? "",
        (r.context as any)?.via_platform_admin ? "yes" : "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
  }
  return lines.join("\n");
}

export function AuditTab({ tenantId }: { tenantId: string }) {
  const fetchAudit = useServerFn(listRecentAudit);
  const q = useQuery({
    queryKey: ["workspace-audit", tenantId],
    queryFn: () => fetchAudit({ data: { tenant_id: tenantId, limit: 200 } }) as unknown as Promise<Row[]>,
  });

  const ready = q.isSuccess && !q.isFetching;
  const rows = ready ? q.data ?? [] : [];

  const { grid, max, totalLast30, totalLastN, distinctActors } = useMemo(() => {
    const today = startOfDay(new Date());
    const start = new Date(today);
    start.setDate(start.getDate() - (DAYS - 1));
    const counts = new Map<string, number>();
    let totalLast30 = 0;
    const cutoff30 = new Date(today);
    cutoff30.setDate(cutoff30.getDate() - 29);
    const actors = new Set<string>();
    for (const r of rows) {
      if (!Number.isFinite(Date.parse(r.occurred_at))) continue;
      const dt = startOfDay(new Date(r.occurred_at));
      if (dt < start) continue;
      const key = dt.toISOString().slice(0, 10);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (dt >= cutoff30) totalLast30++;
      if (r.actor_email) actors.add(r.actor_email);
    }
    const cells: { date: Date; key: string; count: number }[] = [];
    for (let i = 0; i < DAYS; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      cells.push({ date: d, key, count: counts.get(key) ?? 0 });
    }
    // Pad to align by weekday columns. Cells in column-major weeks.
    const leadingPad = start.getDay(); // 0..6 (Sun-first)
    const padded: ({ date: Date; key: string; count: number } | null)[] = [
      ...Array(leadingPad).fill(null),
      ...cells,
    ];
    while (padded.length % 7 !== 0) padded.push(null);
    const weeks: ((typeof cells)[number] | null)[][] = [];
    for (let w = 0; w < padded.length / 7; w++) {
      weeks.push(padded.slice(w * 7, w * 7 + 7));
    }
    const max = Math.max(0, ...cells.map((c) => c.count));
    return { grid: weeks, max, totalLast30, totalLastN: rows.length, distinctActors: actors.size };
  }, [rows]);

  function exportCsv() {
    const blob = new Blob([toCsv(rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-${tenantId}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const weekdayLabels = ["Sun", "", "Tue", "", "Thu", "", "Sat"];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardDescription>Last 30 days in loaded events</CardDescription><CardTitle className="text-2xl">{ready ? totalLast30 : "Unavailable"}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Recent events</CardDescription><CardTitle className="text-2xl">{ready ? totalLastN : "Unavailable"}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Recorded actors in loaded events</CardDescription><CardTitle className="text-2xl">{ready ? distinctActors : "Unavailable"}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Peak day in loaded events</CardDescription><CardTitle className="text-2xl">{ready ? max : "Unavailable"}</CardTitle></CardHeader></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity heatmap</CardTitle>
          <CardDescription>Tenant-scoped activity among the newest 200 authorized events, shown over {DAYS} days. This is a bounded history, not a complete period aggregate.</CardDescription>
        </CardHeader>
        <CardContent>
          {ready ? <div className="flex gap-2 overflow-x-auto">
            <div className="flex flex-col gap-[3px] pt-1 text-[10px] text-muted-foreground">
              {weekdayLabels.map((l, i) => (
                <div key={i} className="h-3 leading-3">{l}</div>
              ))}
            </div>
            <div className="flex gap-[3px]">
              {grid.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-[3px]">
                  {week.map((cell, di) =>
                    cell ? (
                      <div
                        key={di}
                        title={`${cell.key} · ${cell.count} event${cell.count === 1 ? "" : "s"}`}
                        className={`h-3 w-3 rounded-[2px] ${bucketColor(cell.count, max)}`}
                      />
                    ) : (
                      <div key={di} className="h-3 w-3" />
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
           : <p role="status">Activity unavailable while events are loading or access is being checked.</p>}
          <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>Less</span>
            <div className="h-3 w-3 rounded-[2px] bg-muted/40" />
            <div className="h-3 w-3 rounded-[2px] bg-primary/30" />
            <div className="h-3 w-3 rounded-[2px] bg-primary/55" />
            <div className="h-3 w-3 rounded-[2px] bg-primary/75" />
            <div className="h-3 w-3 rounded-[2px] bg-primary" />
            <span>More</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Audit history</CardTitle>
            <CardDescription>Recent authorized tenant events. This view does not independently verify hash-chain integrity.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!ready || rows.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Time</th>
                <th className="px-4 py-2">Actor</th>
                <th className="px-4 py-2">Scope</th>
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Resource</th>
                <th className="px-4 py-2">Via</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(r.occurred_at).toLocaleString()}</td>
                  <td className="px-4 py-2 text-xs">{r.actor_email ?? "Actor not recorded"}</td>
                  <td className="px-4 py-2 text-xs"><Badge variant="outline">{r.scope ?? "—"}</Badge></td>
                  <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{r.resource_type ?? ""}{r.resource_id ? ` · ${r.resource_id}` : ""}</td>
                  <td className="px-4 py-2 text-xs">{(r.context as any)?.via_platform_admin ? <Badge variant="outline">Platform admin</Badge> : null}</td>
                </tr>
              ))}
              {q.isError ? (<tr><td colSpan={6} className="px-4 py-8"><p role="alert">Audit events could not be loaded. Your access or the service may be unavailable.</p><Button variant="outline" onClick={() => void q.refetch()}>Retry</Button></td></tr>) : !ready ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No audit events were returned under your current tenant access.</td></tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
