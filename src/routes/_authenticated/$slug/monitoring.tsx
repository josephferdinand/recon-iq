// C1 — Tenant-scoped monitoring dashboard reading /api/public/metrics-summary.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/$slug/monitoring")({
  component: MonitoringPage,
});

type Row = { bucket: string; count: number; avg_duration_ms: number; error_rate: number };
type Summary = { ai_calls_24h: Row[]; cron_executions_24h: Row[]; source: string };

function MonitoringPage() {
  const q = useQuery<Summary>({
    queryKey: ["metrics-summary"],
    queryFn: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("/api/public/metrics-summary", {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      return (await r.json()) as Summary;
    },
    refetchInterval: 60_000,
  });

  const empty = q.data?.source === "empty";

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Monitoring</h1>
          <p className="text-sm text-muted-foreground">
            Last 24 hours of AI calls and cron executions, sourced from Cloudflare Analytics Engine.
          </p>
        </div>
        <Badge variant={empty ? "outline" : "default"}>
          {empty ? "no analytics token configured" : "live"}
        </Badge>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI calls (24h)</CardTitle>
          <CardDescription>By provider / model.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <MetricTable rows={q.data?.ai_calls_24h ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cron executions (24h)</CardTitle>
          <CardDescription>Pass/fail rate per job.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <MetricTable rows={q.data?.cron_executions_24h ?? []} />
        </CardContent>
      </Card>
    </div>
  );
}

function MetricTable({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-muted-foreground">No data yet.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
        <tr>
          <th className="px-4 py-2">Bucket</th>
          <th className="px-4 py-2 text-right">Count</th>
          <th className="px-4 py-2 text-right">Avg ms</th>
          <th className="px-4 py-2 text-right">Error rate</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.bucket} className="border-b">
            <td className="px-4 py-2 font-mono text-xs">{r.bucket || "—"}</td>
            <td className="px-4 py-2 text-right tabular-nums">{r.count}</td>
            <td className="px-4 py-2 text-right tabular-nums">{Math.round(r.avg_duration_ms ?? 0)}</td>
            <td className="px-4 py-2 text-right tabular-nums">
              {((r.error_rate ?? 0) * 100).toFixed(1)}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
