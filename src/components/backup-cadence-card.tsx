// Backup cadence chart + SLA alert banner.
// - Buckets snapshot_recorded events per day for the last N days (30 or 90).
// - Renders a bar chart of snapshots per day, highlighting gap days
//   (>1x expected interval, based on snapshot_sla_hours).
// - Raises a red alert banner when:
//     * latest snapshot older than snapshot_sla_hours, OR
//     * any restore_failed event exists in the window.
import { useMemo, useState } from "react";
import { differenceInHours, format, startOfDay, subDays } from "date-fns";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Event = {
  id: string;
  event_type: string;
  created_at: string;
  restored_at?: string | null;
  notes?: string | null;
};
type Config = {
  latest_snapshot_at: string | null;
  snapshot_sla_hours: number | null;
  alerts_enabled: boolean | null;
  daily_snapshot_retention_days?: number | null;
};

export function BackupCadenceCard({ events, config }: { events: Event[]; config: Config }) {
  const [window, setWindow] = useState<30 | 90>(30);
  const slaHours = config.snapshot_sla_hours ?? 26;
  const alertsOn = config.alerts_enabled ?? true;

  // Bucket events per day
  const { buckets, gapDays, snapshotDays } = useMemo(() => {
    const today = startOfDay(new Date());
    const map = new Map<string, number>();
    for (let i = window - 1; i >= 0; i--) {
      const d = subDays(today, i);
      map.set(format(d, "yyyy-MM-dd"), 0);
    }
    for (const e of events) {
      if (e.event_type !== "snapshot_recorded") continue;
      const key = format(startOfDay(new Date(e.created_at)), "yyyy-MM-dd");
      if (map.has(key)) map.set(key, (map.get(key) ?? 0) + 1);
    }
    const arr = Array.from(map.entries()).map(([date, count]) => ({
      date,
      short: format(new Date(date), window === 30 ? "MMM d" : "MMM d"),
      count,
      gap: count === 0,
    }));
    return {
      buckets: arr,
      gapDays: arr.filter((b) => b.gap).length,
      snapshotDays: arr.filter((b) => !b.gap).length,
    };
  }, [events, window]);

  // SLA + failure detection
  const latestAgeHours = config.latest_snapshot_at
    ? differenceInHours(new Date(), new Date(config.latest_snapshot_at))
    : null;
  const slaBreached = latestAgeHours !== null && latestAgeHours > slaHours;
  const noSnapshotOnRecord = latestAgeHours === null;
  const failedEvents = events.filter(
    (e) => e.event_type === "restore_failed" || e.event_type === "backup_failed",
  );
  const recentFailures = failedEvents.slice(0, 3);

  const anyAlert = alertsOn && (slaBreached || noSnapshotOnRecord || recentFailures.length > 0);

  return (
    <div className="space-y-4">
      {anyAlert && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" aria-hidden />
            <div className="flex-1">
              <p className="font-semibold text-red-800 dark:text-red-200">Backup SLA alert</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-red-800 dark:text-red-200">
                {slaBreached && (
                  <li>
                    Latest snapshot is <strong>{latestAgeHours}h</strong> old — exceeds
                    SLA of <strong>{slaHours}h</strong>. Escalate to platform operations.
                  </li>
                )}
                {noSnapshotOnRecord && (
                  <li>
                    No <code>latest_snapshot_at</code> recorded. Sync the timestamp from the backend or record a snapshot event.
                  </li>
                )}
                {recentFailures.map((e) => (
                  <li key={e.id}>
                    <Badge variant="destructive" className="mr-2">{e.event_type}</Badge>
                    {new Date(e.created_at).toLocaleString()}
                    {e.notes ? ` — ${e.notes}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
      {!anyAlert && alertsOn && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm flex items-center gap-2 text-foreground">
          <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
          Backups healthy — latest snapshot {latestAgeHours}h ago (SLA {slaHours}h). No failed events in window.
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Snapshot cadence</CardTitle>
            <CardDescription>
              Snapshots per day. Grey bars are <strong>gap days</strong> — no snapshot recorded.
              Retention target: {config.daily_snapshot_retention_days ?? 7} days.
            </CardDescription>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant={window === 30 ? "default" : "outline"} onClick={() => setWindow(30)}>30d</Button>
            <Button size="sm" variant={window === 90 ? "default" : "outline"} onClick={() => setWindow(90)}>90d</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-3 mb-3 text-xs">
            <StatPill label="Days with snapshots" value={`${snapshotDays} / ${window}`} tone="ok" />
            <StatPill label="Gap days" value={String(gapDays)} tone={gapDays > 0 ? "warn" : "ok"} />
            <StatPill label="Coverage" value={`${Math.round((snapshotDays / window) * 100)}%`} tone={snapshotDays / window >= 0.95 ? "ok" : "warn"} />
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={buckets} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="short" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  interval={window === 90 ? 6 : 2} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false} tickLine={false} width={28} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 12,
                    color: "hsl(var(--popover-foreground))",
                  }}
                  formatter={(v: number, _n, p: any) => [v, p?.payload?.gap ? "Gap day" : "Snapshots"]}
                  labelFormatter={(l) => `Day: ${l}`}
                />
                <Bar dataKey={(d: any) => (d.gap ? 0.15 : d.count)} radius={[3, 3, 0, 0]}>
                  {buckets.map((b, i) => (
                    <Cell key={i} fill={b.gap ? "hsl(var(--muted-foreground) / 0.35)" : "hsl(var(--primary))"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatPill({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" }) {
  const cls = tone === "ok" ? "border-primary/40 bg-primary/5" : "border-destructive/40 bg-destructive/5";
  return (
    <div className={`rounded-md border ${cls} px-3 py-2`}>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold text-foreground">{value}</p>
    </div>
  );
}
