import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { getPlatformReconPerformance } from "@/lib/platform-gaps.functions";
import { Activity } from "lucide-react";

function fmtMs(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function PlatformBenchmarksTab() {
  const [tenantId, setTenantId] = useState<string>("");
  const fn = useServerFn(getPlatformReconPerformance);
  const q = useQuery({
    queryKey: ["platform-benchmarks", tenantId],
    queryFn: () => fn({ data: { window_days: 7, tenant_id: tenantId || undefined } }),
  });

  const data = q.data;
  const maxP95 = data?.daily_trend.reduce((m, d) => Math.max(m, d.p95_ms), 1) ?? 1;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4" />Platform recon performance</CardTitle>
          <CardDescription>p50/p95/p99 latency across all tenants, last 7 days.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-2">
            <div>
              <Label htmlFor="tid" className="text-xs">Filter by tenant UUID (optional)</Label>
              <Input
                id="tid"
                placeholder="leave blank for all tenants"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                className="max-w-md"
              />
            </div>
            <Badge variant="outline">{data?.total_runs ?? 0} runs</Badge>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardHeader className="pb-2"><CardDescription>p50</CardDescription></CardHeader>
              <CardContent className="text-2xl font-semibold">{fmtMs(data?.p50_ms ?? 0)}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardDescription>p95</CardDescription></CardHeader>
              <CardContent className="text-2xl font-semibold">{fmtMs(data?.p95_ms ?? 0)}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardDescription>p99</CardDescription></CardHeader>
              <CardContent className="text-2xl font-semibold">{fmtMs(data?.p99_ms ?? 0)}</CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top 5 slowest recon definitions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Definition</th>
                <th className="px-3 py-2">Tenant</th>
                <th className="px-3 py-2">Runs</th>
                <th className="px-3 py-2">p50</th>
                <th className="px-3 py-2">p95</th>
              </tr>
            </thead>
            <tbody>
              {(data?.slowest_definitions ?? []).length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No runs in window.</td></tr>
              )}
              {(data?.slowest_definitions ?? []).map((d) => (
                <tr key={d.definition_id} className="border-b">
                  <td className="px-3 py-2 font-medium">{d.name}</td>
                  <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{d.tenant_id?.slice(0, 8)}</td>
                  <td className="px-3 py-2">{d.run_count}</td>
                  <td className="px-3 py-2">{fmtMs(d.p50_ms)}</td>
                  <td className="px-3 py-2">{fmtMs(d.p95_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Last 7 days p95 trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {(data?.daily_trend ?? []).length === 0 && (
              <div className="text-sm text-muted-foreground">No data.</div>
            )}
            {(data?.daily_trend ?? []).map((d) => (
              <div key={d.date} className="flex items-center gap-2 text-xs">
                <div className="w-20 text-muted-foreground">{d.date}</div>
                <div className="flex-1 h-6 bg-muted rounded overflow-hidden relative">
                  <div
                    className="h-full bg-primary/70"
                    style={{ width: `${(d.p95_ms / maxP95) * 100}%` }}
                  />
                  <div className="absolute inset-0 flex items-center px-2 text-[10px]">
                    p50 {fmtMs(d.p50_ms)} · p95 {fmtMs(d.p95_ms)} · {d.run_count} runs
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
