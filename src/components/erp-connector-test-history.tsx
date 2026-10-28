import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { RefreshCw, CheckCircle2, XCircle, Clock, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  listErpConnectorTestHistory,
  retryLastErpConnectorTest,
} from "@/lib/erp-connectors.functions";

type Props = {
  connectorId: string;
  connectorName: string;
  onAfterRetry?: () => void;
};

export function ErpConnectorTestHistory({ connectorId, connectorName, onAfterRetry }: Props) {
  const [versionFilter, setVersionFilter] = useState<string>("all");
  const listFn = useServerFn(listErpConnectorTestHistory);
  const retryFn = useServerFn(retryLastErpConnectorTest);

  const historyQuery = useQuery({
    queryKey: ["erp-test-history", connectorId, versionFilter],
    queryFn: () =>
      listFn({
        data: {
          connector_id: connectorId,
          limit: 50,
          credential_version:
            versionFilter === "all" ? null : Number(versionFilter),
        },
      }),
    staleTime: 10_000,
  });

  const retryMut = useMutation({
    mutationFn: () => retryFn({ data: { connector_id: connectorId } }),
    onSuccess: (res) => {
      toast[res.ok ? "success" : "error"](`Retry: ${res.message}`);
      historyQuery.refetch();
      onAfterRetry?.();
    },
    onError: (e: any) => toast.error(e?.message ?? "Retry failed"),
  });

  const rows: any[] = historyQuery.data?.history ?? [];
  const versions = useMemo(() => {
    const s = new Set<number>();
    for (const r of rows) if (r.credential_version != null) s.add(r.credential_version);
    return [...s].sort((a, b) => b - a);
  }, [rows]);

  const stats = useMemo(() => {
    if (rows.length === 0) return null;
    const ok = rows.filter((r) => r.ok).length;
    const lats = rows.map((r) => r.latency_ms).filter((n) => typeof n === "number") as number[];
    const p50 = percentile(lats, 0.5);
    const p95 = percentile(lats, 0.95);
    return { total: rows.length, ok, fail: rows.length - ok, p50, p95 };
  }, [rows]);

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">Test history — {connectorName}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Every probe recorded per credential version, with latency and error detail.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={versionFilter} onValueChange={setVersionFilter}>
            <SelectTrigger className="h-8 w-[160px]"><SelectValue placeholder="All versions" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All credential versions</SelectItem>
              {versions.map((v) => (
                <SelectItem key={v} value={String(v)}>Credential v{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            disabled={retryMut.isPending || rows.length === 0}
            onClick={() => retryMut.mutate()}
            title={rows.length === 0 ? "Run a test first" : "Retry the last test with current credentials"}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${retryMut.isPending ? "animate-spin" : ""}`} aria-hidden />
            Retry last test
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {stats ? (
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" aria-hidden /> {stats.ok} pass</Badge>
            <Badge variant="secondary" className="gap-1"><XCircle className="h-3 w-3" aria-hidden /> {stats.fail} fail</Badge>
            <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" aria-hidden /> p50 {fmt(stats.p50)} ms · p95 {fmt(stats.p95)} ms</Badge>
            <Badge variant="secondary" className="gap-1">{stats.total} recent</Badge>
          </div>
        ) : null}

        {historyQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading history…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tests recorded for this credential version yet. Run a test to populate history.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>HTTP</TableHead>
                  <TableHead>Latency</TableHead>
                  <TableHead>Credential</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Date(r.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {r.ok ? (
                        <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" aria-hidden /> ok</Badge>
                      ) : (
                        <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" aria-hidden /> fail</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.http_status ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.latency_ms != null ? `${r.latency_ms} ms` : "—"}</TableCell>
                    <TableCell className="text-xs">
                      {r.credential_version != null ? (
                        <span className="inline-flex items-center gap-1">
                          <ShieldCheck className="h-3 w-3 text-muted-foreground" aria-hidden />
                          v{r.credential_version}
                          {r.credential_fingerprint ? (
                            <span className="font-mono text-muted-foreground">
                              · {String(r.credential_fingerprint).slice(0, 8)}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">none</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="outline">{r.trigger_source}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[360px] text-xs">
                      {r.ok ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div>
                          {r.error_kind ? (
                            <Badge variant="outline" className="mr-1">{r.error_kind}</Badge>
                          ) : null}
                          <span className="text-muted-foreground">{r.error_message}</span>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}
function fmt(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n)) : "—";
}
