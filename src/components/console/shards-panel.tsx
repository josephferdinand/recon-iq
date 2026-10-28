/**
 * ShardsPanel — Enhanced Shards tab for the Scale Console.
 * Adds p50/p95/p99 latency, skew index, throughput, and executor-plan preview.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyStateAction } from "@/components/console-header";
import { listShardExecutors, listShardRuns, planShards } from "@/lib/phase8-shard-executor.functions";

type ShardRun = {
  id: string;
  recon_run_id?: string | null;
  executor_code: string;
  shard_index: number;
  shard_count: number;
  status: string;
  rows_in?: number | null;
  rows_matched?: number | null;
  rows_unmatched?: number | null;
  started_at?: string | null;
  ended_at?: string | null;
  error_text?: string | null;
};
type Executor = { code: string; name: string; max_shards: number };

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function ShardsPanel({ tenantId }: { tenantId: string }) {
  const lx = useServerFn(listShardExecutors);
  const lr = useServerFn(listShardRuns);
  const execs = useQuery({ queryKey: ["shards-exec"], queryFn: () => lx({ data: {} }) });
  const runsQ = useQuery({ queryKey: ["shards-runs", tenantId], queryFn: () => lr({ data: { tenant_id: tenantId, limit: 500 } }) });

  const executors = (execs.data ?? []) as Executor[];
  const runs = (runsQ.data ?? []) as ShardRun[];

  // Latency and skew
  const durations = runs
    .filter((r) => r.started_at && r.ended_at)
    .map((r) => (new Date(r.ended_at!).getTime() - new Date(r.started_at!).getTime()) / 1000)
    .filter((d) => d >= 0)
    .sort((a, b) => a - b);
  const p50 = pct(durations, 50);
  const p95 = pct(durations, 95);
  const p99 = pct(durations, 99);

  // Skew index — how uneven rows are distributed across shards (max/mean)
  const byRun: Record<string, number[]> = {};
  runs.forEach((r) => {
    if (!r.recon_run_id) return;
    byRun[r.recon_run_id] = byRun[r.recon_run_id] ?? [];
    byRun[r.recon_run_id].push(r.rows_in ?? 0);
  });
  const skews = Object.values(byRun).map((arr) => {
    if (arr.length === 0) return 1;
    const max = Math.max(...arr);
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return mean === 0 ? 1 : max / mean;
  });
  const avgSkew = skews.length ? (skews.reduce((a, b) => a + b, 0) / skews.length) : 1;

  const totalRowsIn = runs.reduce((a, r) => a + Number(r.rows_in ?? 0), 0);
  const totalMatched = runs.reduce((a, r) => a + Number(r.rows_matched ?? 0), 0);
  const failed = runs.filter((r) => r.status === "failed").length;
  const queued = runs.filter((r) => r.status === "queued" || r.status === "pending").length;

  const previewExec = executors[0];
  const preview = previewExec ? planShards(previewExec.code, Math.min(8, previewExec.max_shards), 1_000_000) : [];

  return (
    <div className="space-y-4 pt-4">
      {runsQ.isLoading || execs.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Tile label="Rows in" value={totalRowsIn.toLocaleString()} />
          <Tile label="Matched" value={totalMatched.toLocaleString()} tone="positive" />
          <Tile label="p50 latency" value={`${p50.toFixed(1)}s`} />
          <Tile label="p95 latency" value={`${p95.toFixed(1)}s`} tone={p95 > 60 ? "warning" : "default"} />
          <Tile label="p99 latency" value={`${p99.toFixed(1)}s`} tone={p99 > 120 ? "warning" : "default"} />
          <Tile label="Skew index" value={avgSkew.toFixed(2)} tone={avgSkew > 2 ? "warning" : "positive"} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Executor registry</CardTitle>
          <CardDescription>Strategies for partitioning a single recon job across many workers.</CardDescription>
        </CardHeader>
        <CardContent>
          {execs.isLoading ? <Skeleton className="h-24" /> : executors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No executors registered.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground"><th className="py-1">Code</th><th>Name</th><th className="text-right">Max shards</th></tr></thead>
              <tbody>
                {executors.map((e) => (
                  <tr key={e.code} className="border-t"><td className="py-1"><code>{e.code}</code></td><td>{e.name}</td><td className="text-right font-mono">{e.max_shards}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {previewExec && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plan preview</CardTitle>
            <CardDescription>Estimated rows per shard for a 1M row workload on <code>{previewExec.code}</code>.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-1 items-end h-24">
              {preview.map((p) => {
                const max = Math.max(...preview.map((x) => x.rows_estimate));
                const h = max > 0 ? Math.max(6, Math.round((p.rows_estimate / max) * 96)) : 6;
                return (
                  <div key={p.shard_index} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full bg-emerald-500/40 rounded-t" style={{ height: h }} />
                    <span className="text-[10px] text-muted-foreground">#{p.shard_index}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-2">Total 1,000,000 rows across {preview.length} shards.</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent shard runs</CardTitle>
          <CardDescription>Latest {Math.min(runs.length, 50)} of {runs.length} · {failed} failed · {queued} queued</CardDescription>
        </CardHeader>
        <CardContent>
          {runsQ.isLoading ? <Skeleton className="h-24" /> : runs.length === 0 ? (
            <EmptyStateAction
              title="No shard runs yet"
              description="Submit a recon that uses a sharded executor and this table will populate with per-shard latency and throughput."
              actions={[{ label: "Recon definitions", href: "../../recons" }]}
            />
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1">Executor</th><th>Shard</th><th>Status</th><th className="text-right">Rows in</th><th className="text-right">Matched</th><th className="text-right">Unmatched</th><th className="text-right">Duration</th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 50).map((r) => {
                  const dur = r.started_at && r.ended_at
                    ? ((new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 1000).toFixed(1) + "s"
                    : "—";
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="py-1"><code>{r.executor_code}</code></td>
                      <td>{r.shard_index}/{r.shard_count}</td>
                      <td><Badge variant={r.status === "failed" ? "destructive" : r.status === "succeeded" || r.status === "completed" ? "default" : "secondary"}>{r.status}</Badge></td>
                      <td className="text-right font-mono">{Number(r.rows_in ?? 0).toLocaleString()}</td>
                      <td className="text-right font-mono">{Number(r.rows_matched ?? 0).toLocaleString()}</td>
                      <td className="text-right font-mono">{Number(r.rows_unmatched ?? 0).toLocaleString()}</td>
                      <td className="text-right font-mono">{dur}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string | number; tone?: "positive" | "warning" | "danger" | "default" }) {
  const toneClass = tone === "positive" ? "text-emerald-800 dark:text-emerald-300" : tone === "warning" ? "text-amber-700 dark:text-amber-300" : tone === "danger" ? "text-rose-700 dark:text-rose-300" : "text-foreground";
  return (
    <div className="rounded-md border p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold mt-1 ${toneClass}`}>{value}</p>
    </div>
  );
}
